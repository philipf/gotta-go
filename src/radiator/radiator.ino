/**
 * GottaGo — LilyGO T5 4.7" radiator firmware
 *
 * One wake cycle:
 *   Wi-Fi  →  HTTPS GET /v1/frame (gzipped BMP) →  inflate  →  BMP decode
 *          →  panel flush  →  deep sleep for X-Sleep-Seconds
 *
 * Composes three closed spikes:
 *   poc/lilygo/wake-cycle-32 — Wi-Fi + HTTPS GET + esp_deep_sleep
 *   poc/lilygo/show-bmp-31   — 1-bit BMP byte array → 4bpp framebuffer → panel
 *   ADR-0008 (uzlib)         — inflate Content-Encoding: gzip in firmware
 *
 * Firmware response handling follows ADR-0003 §Radiator firmware behaviour —
 * non-2xx and parse failures never touch the panel; X-Sleep-Seconds dictates
 * the next wake; a 300 s firmware fallback covers the cases where the radiator
 * can't extract a usable header (no response, missing header, value out of
 * range [1, 86400]).
 *
 * Toolchain pinned by ADR-0006: arduino-cli + esp32:esp32@2.0.15 +
 * LilyGo-EPD47@1.0.1 + uzlib. FQBN lives in sketch.yaml.
 *
 * Settings (Wi-Fi creds, Worker URL, shared token, slug) live in settings.h —
 * gitignored; copy from settings.example.h before flashing.
 */

#ifndef BOARD_HAS_PSRAM
#error "Enable PSRAM: Arduino IDE -> Tools -> PSRAM -> OPI (sketch.yaml encodes this in the FQBN)"
#endif

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
extern "C" {
#include "src/uzlib/uzlib.h"
}

#include "epd_driver.h"
#include "settings.h"  // WIFI_SSID, WIFI_PASSWORD, FRAME_URL, RADIATOR_TOKEN, RADIATOR_SLUG

// Firmware fallback sleep duration (seconds). Applied only when no usable
// X-Sleep-Seconds value reached the radiator — see ADR-0003.
static const uint32_t FIRMWARE_FALLBACK_SLEEP_S = 300;

// Wi-Fi association timeout. A flaky AP can never wedge the cycle: we sleep
// for the firmware fallback and try again next wake.
static const uint32_t WIFI_TIMEOUT_MS = 15000;

// X-Sleep-Seconds clamp. ADR-0003's Worker contract puts sleep_seconds in
// [30, 14400], but the radiator's accept-range is the broader [1, 86400] —
// any integer in that range is a valid Worker directive (e.g. during a
// staged rollout). Values outside the range fall to the firmware default.
static const uint32_t SLEEP_S_MIN = 1;
static const uint32_t SLEEP_S_MAX = 86400;

// Compressed body sanity bound. Headroom over the ~525 B observed on
// minimal_clock; if a future frame profile exceeds this we'll need streaming
// inflate (see ADR-0008 reversal trigger). Keeping it small keeps the PSRAM
// allocation honest and surfaces growth early.
static const size_t MAX_COMPRESSED_BYTES = 8192;

// Expected uncompressed frame size (BMP header + 1bpp pixel data for 960x540).
static const size_t EXPECTED_BMP_BYTES = 64862;

// uzlib needs a small dictionary for sliding-window matches.
static const size_t UZLIB_DICT_BYTES = 32768;

// Outcome of one wake cycle's network + decode work. The sleep policy
// downstream is driven entirely by this enum — see sleepFor() and ADR-0003.
enum class CycleResult {
    Ok,             // 200 + valid BMP. flushed to panel. sleep = X-Sleep-Seconds.
    HttpError,      // non-2xx (or transport failure). panel untouched.
    BodyTooLarge,   // body exceeded MAX_COMPRESSED_BYTES. panel untouched.
    InflateFailed,  // gzip inflate produced wrong size or returned an error.
    BmpInvalid,     // inflated bytes did not parse as a 960x540 1bpp BMP.
};

// Sleep header parser tri-state. Distinct from "missing" because a value of
// e.g. 0 or 999999 from a misbehaving Worker must fall to the fallback, not
// silently clamp.
struct SleepHeader {
    bool present;
    uint32_t seconds;  // valid only when present
};

// Wake counter parked in RTC slow memory — survives deep sleep, zeroed only
// on a true cold boot. Used to disambiguate cold-boot vs timer-wake in logs.
RTC_DATA_ATTR uint32_t wakeCount = 0;

// PSRAM scratch buffers. Re-allocated per cycle (deep sleep wipes the heap on
// wake anyway), but declared here so the wake-path code reads top-down.
static uint8_t *compressedBuf = nullptr;
static uint8_t *inflatedBuf = nullptr;
static uint8_t *uzlibDict = nullptr;
static uint8_t *epdFramebuffer = nullptr;

// ---------- Helpers ----------

static const char *wakeReasonStr(esp_sleep_wakeup_cause_t cause) {
    switch (cause) {
        case ESP_SLEEP_WAKEUP_TIMER: return "timer (deep-sleep wake)";
        case ESP_SLEEP_WAKEUP_UNDEFINED: return "power-on / hard reset (cold boot)";
        default: return "other";
    }
}

// Little-endian field readers over a flash- or PSRAM-resident BMP byte array.
static uint16_t bmpU16(const uint8_t *p, uint32_t off) {
    return (uint16_t)p[off] | ((uint16_t)p[off + 1] << 8);
}
static uint32_t bmpU32(const uint8_t *p, uint32_t off) {
    return (uint32_t)p[off] | ((uint32_t)p[off + 1] << 8) |
           ((uint32_t)p[off + 2] << 16) | ((uint32_t)p[off + 3] << 24);
}
static int32_t bmpI32(const uint8_t *p, uint32_t off) {
    return (int32_t)bmpU32(p, off);
}

// Parse a header value (`Sleep-Seconds`, `Content-Length`, …) into a uint32_t
// if it sits cleanly in [SLEEP_S_MIN, SLEEP_S_MAX]. Returns { present: false }
// for any of: header absent, empty string, non-integer, or out-of-range value.
// The strictness is deliberate per ADR-0003: a Worker that hands us "0" or
// "garbage" gets the firmware fallback, not a 0-second hot loop.
static SleepHeader parseSleepSeconds(HTTPClient &https) {
    const String raw = https.header("X-Sleep-Seconds");
    if (raw.length() == 0) return {false, 0};
    char *end = nullptr;
    const long parsed = strtol(raw.c_str(), &end, 10);
    if (end == raw.c_str() || *end != '\0') return {false, 0};
    if (parsed < (long)SLEEP_S_MIN || parsed > (long)SLEEP_S_MAX) return {false, 0};
    return {true, (uint32_t)parsed};
}

// Sleep decision per ADR-0003 firmware response handling table. The caller
// names which row fired (for the serial log) and supplies the header value
// already parsed by parseSleepSeconds().
static void sleepFor(CycleResult outcome, SleepHeader sleep, uint32_t awakeMs) {
    uint32_t seconds = sleep.present ? sleep.seconds : FIRMWARE_FALLBACK_SLEEP_S;
    const char *source = sleep.present ? "X-Sleep-Seconds" : "firmware fallback";

    const char *outcomeStr = "?";
    switch (outcome) {
        case CycleResult::Ok:            outcomeStr = "ok"; break;
        case CycleResult::HttpError:     outcomeStr = "http-error"; break;
        case CycleResult::BodyTooLarge:  outcomeStr = "body-too-large"; break;
        case CycleResult::InflateFailed: outcomeStr = "inflate-failed"; break;
        case CycleResult::BmpInvalid:    outcomeStr = "bmp-invalid"; break;
    }

    Serial.printf("Cycle #%lu: outcome=%s, awake %lu ms, sleeping %lu s (%s)\n",
                  (unsigned long)wakeCount, outcomeStr,
                  (unsigned long)awakeMs, (unsigned long)seconds, source);
    Serial.flush();  // drain the USB CDC FIFO before the peripheral powers down

    esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
    esp_deep_sleep_start();  // never returns
}

// ---------- Wi-Fi ----------

static bool connectWiFi() {
    Serial.printf("Wi-Fi: connecting to \"%s\"\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    const uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - t0) < WIFI_TIMEOUT_MS) {
        delay(100);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.printf("Wi-Fi: FAILED within %lu ms\n", (unsigned long)WIFI_TIMEOUT_MS);
        return false;
    }
    Serial.printf("Wi-Fi: connected in %lu ms — IP %s, RSSI %d dBm\n",
                  (unsigned long)(millis() - t0),
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return true;
}

// ---------- HTTP fetch ----------

// One wake cycle's request. Returns the outcome plus (on success) the
// inflated BMP byte count via outInflatedBytes. The HTTPClient is configured
// to collect X-Sleep-Seconds via collectHeaders() so the caller can still
// honour the Worker's sleep directive on a non-2xx.
static CycleResult fetchAndInflate(HTTPClient &https,
                                   WiFiClientSecure &client,
                                   size_t *outInflatedBytes,
                                   SleepHeader *outSleep) {
    // Spike-grade TLS: skip server-cert validation. Production radiator
    // would pin or bundle the CA for the Worker host — out of scope for
    // this tracer, but called out in the README and ADR-0003's
    // Negative consequences list.
    client.setInsecure();

    Serial.printf("HTTPS: GET %s\n", FRAME_URL);
    if (!https.begin(client, FRAME_URL)) {
        Serial.println("HTTPS: begin() failed (bad URL?)");
        return CycleResult::HttpError;
    }

    // Force HTTP/1.0 with Connection: close. Avoids two pieces of HTTP/1.1
    // muddle on the cloudflared path: chunked Transfer-Encoding (which
    // hides the body length from HTTPClient) and keep-alive (which makes
    // detecting end-of-body via connection-close unreliable). The body is
    // still gzipped — Accept-Encoding survives the downgrade.
    https.useHTTP10(true);

    // ADR-0003 / AC-F1: every wake sends the slug, the shared token, gzip
    // acceptance, and (where supported) the ESP32-S3 MAC as the hardware id.
    https.addHeader("X-Radiator-Slug", RADIATOR_SLUG);
    https.addHeader("X-Radiator-Token", RADIATOR_TOKEN);
    https.addHeader("Accept-Encoding", "gzip");
    const String mac = WiFi.macAddress();
    if (mac.length() > 0) {
        https.addHeader("X-Radiator-Hardware-Id", mac);
    }

    // Dev-only: when settings.h defines DEBUG_NOW, send it so the Worker resolves
    // the profile phase against that instant instead of real time (lets you
    // preview e.g. morning_school_run any time of day). Requires the Worker to
    // run with DEV_TIME_OVERRIDE=true; ignored in production. Compile-time gated,
    // so a normal build that leaves DEBUG_NOW undefined sends nothing.
#ifdef DEBUG_NOW
    https.addHeader("X-Debug-Now", DEBUG_NOW);
#endif

    // Retain the diagnostic headers we want to read off the response.
    // Content-Length is tracked internally by HTTPClient regardless of
    // this list.
    static const char *kept[] = {"X-Sleep-Seconds", "X-Profile-Phase",
                                 "X-Server-Time"};
    https.collectHeaders(kept, sizeof(kept) / sizeof(kept[0]));

    const uint32_t t0 = millis();
    const int status = https.GET();
    const uint32_t reqMs = millis() - t0;
    *outSleep = parseSleepSeconds(https);

    if (status <= 0) {
        Serial.printf("HTTPS: request failed: %s (%lu ms)\n",
                      HTTPClient::errorToString(status).c_str(),
                      (unsigned long)reqMs);
        https.end();
        return CycleResult::HttpError;
    }
    Serial.printf("HTTPS: status %d, content-length %d, sleep=%s (%lu ms)\n",
                  status, https.getSize(),
                  outSleep->present ? String(outSleep->seconds).c_str() : "(missing)",
                  (unsigned long)reqMs);

    if (status < 200 || status >= 300) {
        https.end();
        return CycleResult::HttpError;
    }

    // Drain the response into the compressed scratch buffer. Byte-at-a-time
    // matches the wake-cycle-32 pattern and avoids the available()-vs-actual
    // confusion that the TLS layer's record-sized buffer introduces. We cap
    // on bytes actually received (total), never on available(), so a chatty
    // TLS buffer can never spuriously trip BodyTooLarge.
    WiFiClient *stream = https.getStreamPtr();
    const int expectedSize = https.getSize();  // -1 when server omits Content-Length
    size_t total = 0;
    const uint32_t readStart = millis();
    while ((millis() - readStart) < 10000) {
        while (stream->available() && total < MAX_COMPRESSED_BYTES) {
            compressedBuf[total++] = (uint8_t)stream->read();
        }
        if (total >= MAX_COMPRESSED_BYTES) {
            Serial.printf("body: exceeds %u byte cap (read so far)\n",
                          (unsigned)MAX_COMPRESSED_BYTES);
            https.end();
            return CycleResult::BodyTooLarge;
        }
        if (expectedSize != -1 && total >= (size_t)expectedSize) break;
        if (!https.connected()) {
            // Drain any tail bytes the TLS layer still has buffered after
            // the server closed the connection. Bound by expectedSize when
            // known so a trailing CRLF (or similar) doesn't sneak past.
            delay(20);
            const size_t cap = (expectedSize != -1)
                ? (size_t)expectedSize
                : MAX_COMPRESSED_BYTES;
            while (stream->available() && total < cap) {
                compressedBuf[total++] = (uint8_t)stream->read();
            }
            break;
        }
        delay(1);
    }
    https.end();
    Serial.printf("body: %u bytes received (Content-Length=%d)\n",
                  (unsigned)total, expectedSize);

    // ADR-0008: one-shot inflate. Compressed body is small enough (<= 8 KB)
    // to live alongside the inflated frame in PSRAM during this call.
    uzlib_init();
    TINF_DATA d;
    memset(&d, 0, sizeof(d));
    d.source = compressedBuf;
    d.source_limit = compressedBuf + total;
    d.source_read_cb = NULL;

    uzlib_uncompress_init(&d, uzlibDict, UZLIB_DICT_BYTES);

    const int hdr = uzlib_gzip_parse_header(&d);
    if (hdr != TINF_OK) {
        Serial.printf("inflate: gzip header parse failed (err=%d)\n", hdr);
        return CycleResult::InflateFailed;
    }

    d.dest_start = d.dest = inflatedBuf;
    d.dest_limit = inflatedBuf + EXPECTED_BMP_BYTES;
    const uint32_t inflateStart = millis();
    const int res = uzlib_uncompress_chksum(&d);
    const uint32_t inflateMs = millis() - inflateStart;
    // TINF_OK (0) = success while filling dest; TINF_DONE (1) = success with
    // end-of-stream marker observed. Either means the output buffer holds
    // valid inflated bytes. Negative values are real failures.
    if (res != TINF_DONE && res != TINF_OK) {
        Serial.printf("inflate: failed (res=%d, produced=%u bytes)\n",
                      res, (unsigned)(d.dest - inflatedBuf));
        return CycleResult::InflateFailed;
    }
    const size_t produced = (size_t)(d.dest - inflatedBuf);
    Serial.printf("inflate: ok %u bytes in %lu ms\n",
                  (unsigned)produced, (unsigned long)inflateMs);
    if (produced != EXPECTED_BMP_BYTES) {
        Serial.printf("inflate: size mismatch (expected %u)\n",
                      (unsigned)EXPECTED_BMP_BYTES);
        return CycleResult::InflateFailed;
    }
    *outInflatedBytes = produced;
    return CycleResult::Ok;
}

// ---------- BMP → framebuffer (ported from poc/lilygo/show-bmp-31) ----------

static bool decodeBmpToFramebuffer(const uint8_t *bmp, uint32_t len, uint8_t *fb) {
    if (len < 62 || bmp[0] != 'B' || bmp[1] != 'M') {
        Serial.println("BMP: bad magic / too short");
        return false;
    }
    const uint32_t dataOffset = bmpU32(bmp, 10);
    const int32_t  width      = bmpI32(bmp, 18);
    const int32_t  rawHeight  = bmpI32(bmp, 22);
    const uint16_t bpp        = bmpU16(bmp, 28);
    const uint32_t compression = bmpU32(bmp, 30);
    const bool    topDown = rawHeight < 0;
    const int32_t height  = topDown ? -rawHeight : rawHeight;

    Serial.printf("BMP: %ldx%ld %ubpp comp=%lu offset=%lu %s\n",
                  (long)width, (long)height, bpp, (unsigned long)compression,
                  (unsigned long)dataOffset, topDown ? "top-down" : "bottom-up");

    if (bpp != 1 || compression != 0) {
        Serial.println("BMP: expected uncompressed 1bpp");
        return false;
    }
    if (width != EPD_WIDTH || height != EPD_HEIGHT) {
        Serial.printf("BMP: expected %dx%d to match panel\n", EPD_WIDTH, EPD_HEIGHT);
        return false;
    }

    const uint32_t rowStride = (((uint32_t)width * bpp + 31) / 32) * 4;
    if (dataOffset + rowStride * (uint32_t)height > len) {
        Serial.println("BMP: pixel data runs past end of array");
        return false;
    }

    for (int32_t srcRow = 0; srcRow < height; srcRow++) {
        const int32_t y = topDown ? srcRow : (height - 1 - srcRow);
        const uint8_t *row = bmp + dataOffset + (uint32_t)srcRow * rowStride;
        for (int32_t x = 0; x < width; x++) {
            const uint8_t bit = (row[x >> 3] >> (7 - (x & 7))) & 0x01;
            if (bit) {
                // Set bit = palette idx 1 = black = ink on. The framebuffer
                // is pre-filled white, so we stamp only the black pixels.
                epd_draw_pixel(x, y, 0x00, fb);
            }
        }
    }
    return true;
}

static bool flushToPanel(const uint8_t *bmp, size_t bmpLen) {
    const size_t fbSize = EPD_WIDTH / 2 * EPD_HEIGHT;
    epdFramebuffer = (uint8_t *)heap_caps_malloc(fbSize, MALLOC_CAP_SPIRAM);
    if (!epdFramebuffer) {
        Serial.println("framebuffer alloc failed — PSRAM exhausted?");
        return false;
    }
    memset(epdFramebuffer, 0xFF, fbSize);  // 0xF nibble = white

    const uint32_t t0 = millis();
    if (!decodeBmpToFramebuffer(bmp, (uint32_t)bmpLen, epdFramebuffer)) {
        free(epdFramebuffer);
        epdFramebuffer = nullptr;
        return false;
    }
    Serial.printf("decode: ok in %lu ms\n", (unsigned long)(millis() - t0));

    epd_poweron();
    epd_clear();                                      // wipe to avoid ghosting
    epd_draw_grayscale_image(epd_full_screen(), epdFramebuffer);
    epd_poweroff();

    free(epdFramebuffer);
    epdFramebuffer = nullptr;
    Serial.println("panel: frame latched");
    return true;
}

// ---------- Wake path ----------

void setup() {
    const uint32_t wakeStart = millis();

    Serial.begin(115200);
    delay(1000);  // let the host re-attach the CDC after the wake re-enumeration

    wakeCount++;
    Serial.println();
    Serial.printf("=== GottaGo wake cycle #%lu — wake reason: %s ===\n",
                  (unsigned long)wakeCount,
                  wakeReasonStr(esp_sleep_get_wakeup_cause()));

    // Allocate PSRAM scratch up front. If any of these fail there's no
    // recovery — sleep on the firmware fallback and try again next wake.
    compressedBuf = (uint8_t *)heap_caps_malloc(MAX_COMPRESSED_BYTES, MALLOC_CAP_SPIRAM);
    inflatedBuf   = (uint8_t *)heap_caps_malloc(EXPECTED_BMP_BYTES,   MALLOC_CAP_SPIRAM);
    uzlibDict     = (uint8_t *)heap_caps_malloc(UZLIB_DICT_BYTES,     MALLOC_CAP_SPIRAM);
    if (!compressedBuf || !inflatedBuf || !uzlibDict) {
        Serial.println("PSRAM alloc failed — sleeping on firmware fallback");
        sleepFor(CycleResult::HttpError, {false, 0}, millis() - wakeStart);
    }

    epd_init();

    SleepHeader sleep = {false, 0};
    CycleResult outcome = CycleResult::HttpError;
    size_t inflatedBytes = 0;

    if (connectWiFi()) {
        WiFiClientSecure client;
        HTTPClient https;
        outcome = fetchAndInflate(https, client, &inflatedBytes, &sleep);

        if (outcome == CycleResult::Ok) {
            if (!flushToPanel(inflatedBuf, inflatedBytes)) {
                outcome = CycleResult::BmpInvalid;
            }
        }
    }
    WiFi.disconnect(true);  // drop the radio before sleeping

    sleepFor(outcome, sleep, millis() - wakeStart);
}

void loop() {
    // Unreachable: esp_deep_sleep_start() in setup() never returns.
}
