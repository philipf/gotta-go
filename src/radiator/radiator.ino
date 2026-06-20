/**
 * GottaGo — LilyGO T5 4.7" radiator firmware
 *
 * One wake cycle:
 *   Wi-Fi  →  HTTPS GET /v1/frame (If-None-Match: stored ETag)
 *          →  200: inflate  →  BMP decode  →  panel flush  →  store ETag
 *          →  304: unchanged-frame skip — panel untouched (ADR-0013)
 *          →  deep sleep for X-Sleep-Seconds
 *
 * Composes three closed spikes:
 *   poc/lilygo/wake-cycle-32 — Wi-Fi + HTTPS GET + esp_deep_sleep
 *   poc/lilygo/show-bmp-31   — 1-bit BMP byte array → 4bpp framebuffer → panel
 *   ADR-0008 (uzlib)         — inflate Content-Encoding: gzip in firmware
 *
 * Split across translation units (GH #63) for navigability and host-testability:
 *   net.{h,cpp}     — Wi-Fi + HTTP request + body drain + gzip inflate
 *   frame.{h,cpp}   — 1bpp BMP decode + panel flush
 *   problem.{h,cpp} — problem+json parse + error-screen render (ADR-0011)
 *   etag.h          — stored-ETag store/keep/clear policy (ADR-0013)
 *   sleep.{h,cpp}   — X-Sleep-Seconds parse + sleep policy + deep sleep (ADR-0003)
 *   battery.{h,cpp} — battery-voltage sample → X-Radiator-Battery-Mv (GH #79)
 * This file is the wake-cycle orchestrator: it allocates scratch, drives one
 * request via net, and maps the response onto the ADR-0003/0011 table below.
 *
 * Firmware response handling follows ADR-0003 §Radiator firmware behaviour and
 * ADR-0011 §error screen. A reachable Worker error — a non-2xx carrying an
 * RFC 9457 application/problem+json body — renders a generic on-panel error
 * screen (its title as heading, detail as body) instead of silently holding the
 * last frame, so a bad token or a Metlink outage is visible (CycleResult::
 * WorkerError). A transport failure / no response (Wi-Fi/DNS/TCP/TLS dead)
 * still leaves the panel untouched (CycleResult::HttpError, #47's arm), as do
 * 200-OK inflate/parse failures. A 304 Not Modified (ADR-0013, GH #74) is the
 * unchanged-frame skip: the stored ETag (RTC-backed, echoed as If-None-Match
 * each wake) matched, so the panel keeps its frame — no flush, no eye-pull
 * (CycleResult::NotModified; bookkeeping rules in etag.h). X-Sleep-Seconds
 * dictates the next wake on every arm, 304 included; a 300 s firmware fallback
 * covers the cases where the radiator can't extract a usable header (no
 * response, missing header, value out of range [1, 86400]).
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

#include "epd_driver.h"  // epd_init() — panel bring-up
#include "battery.h"     // sampleBatteryMv — must run before connectWiFi (ADC2)
#include "net.h"  // connectWiFi, WifiResult, fetchFrame, classifyResponse, inflateGzip, decodeBodyText, HttpResponse, BodyText
#include "frame.h"     // flushToPanel, EXPECTED_BMP_BYTES
#include "problem.h"   // parseProblem, resolveErrorScreen, renderErrorScreen
#include "etag.h"      // ETAG_CAP, PanelState, EtagAction, panelStateAfter, chooseEtagAction
#include "sleep.h"     // CycleResult, SleepHeader, sleepFor
#include "settings.h"  // RADIATOR_VERBOSE (creds/URL are net.cpp's)

// Verbose: gate rendering of upstream_detail on the error screen. Default off;
// override in settings.h. Namespaced like RADIATOR_TOKEN / RADIATOR_SLUG. The
// #ifndef guard lets an existing settings.h without the define still compile.
#ifndef RADIATOR_VERBOSE
#define RADIATOR_VERBOSE 0
#endif

// Debug build: keep the 1 s CDC re-attach delay on *every* wake so timer-wake
// banners are visible over the re-enumerated USB CDC. Default off — a battery
// radiator should not burn ~1 s of active current per wake just for logs nobody
// is watching (GH #89). Cold boot always delays regardless (see announceWake).
// A power/timing axis, deliberately distinct from RADIATOR_VERBOSE's display
// axis. Namespaced and #ifndef-guarded like RADIATOR_VERBOSE.
#ifndef RADIATOR_DEBUG
#define RADIATOR_DEBUG 0
#endif

// Wake counter parked in RTC slow memory — survives deep sleep, zeroed only
// on a true cold boot. Used to disambiguate cold-boot vs timer-wake in logs.
RTC_DATA_ATTR uint32_t wakeCount = 0;

// Stored ETag, also RTC slow memory (ADR-0013): the opaque validator naming
// the frame the panel currently shows, echoed as If-None-Match each wake.
// Survives deep sleep; zeroed on cold boot, so the first wake after power
// loss sends no If-None-Match and takes one redundant 200 redraw — safe.
// Kept truthful by applyEtagAction() after every cycle (rules in etag.h).
RTC_DATA_ATTR char storedEtag[ETAG_CAP];

// PSRAM scratch buffers. Re-allocated per cycle (deep sleep wipes the heap on
// wake anyway), but declared here so the wake-path code reads top-down.
static uint8_t* compressedBuf = nullptr;
static uint8_t* inflatedBuf   = nullptr;
static uint8_t* uzlibDict     = nullptr;

// ---------- Helpers ----------

static const char* wakeReasonStr(esp_sleep_wakeup_cause_t cause) {
    switch (cause) {
        case ESP_SLEEP_WAKEUP_TIMER:
            return "timer (deep-sleep wake)";
        case ESP_SLEEP_WAKEUP_UNDEFINED:
            return "power-on / hard reset (cold boot)";
        default:
            return "other";
    }
}

// ---------- Response handlers (the content half of the ADR table) ----------

// 200 OK: inflate the gzipped BMP into the frame buffer, size-check it, and
// flush it to the panel (ADR-0008 one-shot inflate; ADR-0003 happy path).
static CycleResult handleFrameResponse(const HttpResponse& r) {
    const uint32_t inflateStart = millis();
    const long produced = inflateGzip(compressedBuf, r.bodyLen, inflatedBuf, EXPECTED_BMP_BYTES,
                                      uzlibDict, UZLIB_DICT_BYTES);
    if (produced < 0) {
        return CycleResult::InflateFailed;
    }
    Serial.printf("inflate: ok %ld bytes in %lu ms\n", produced,
                  (unsigned long)(millis() - inflateStart));
    if ((size_t)produced != EXPECTED_BMP_BYTES) {
        Serial.printf("inflate: size mismatch (expected %u)\n", (unsigned)EXPECTED_BMP_BYTES);
        return CycleResult::InflateFailed;
    }
    return flushToPanel(inflatedBuf, (size_t)produced) ? CycleResult::Ok : CycleResult::BmpInvalid;
}

// Reachable non-2xx: decode the body (inflating iff the edge gzipped it in
// transit, Decision 2) via net and render the error screen. An empty or
// unparseable body leaves the doc empty, which resolveErrorScreen() turns into
// the generic screen using the HTTP status (ADR-0011, Decision 8).
static void renderWorkerError(const HttpResponse& r) {
    Serial.printf("worker-error: reachable status=%d — rendering error screen\n", r.status);
    const BodyText body = decodeBodyText(r, compressedBuf, inflatedBuf, EXPECTED_BMP_BYTES,
                                         uzlibDict, UZLIB_DICT_BYTES);
    renderProblemScreen(body.ptr, body.len, r.status, RADIATOR_VERBOSE);
}

// Wi-Fi never associated: render a local error screen naming the AP and the
// failure reason — the ADR-0011 renderErrorScreen() primitive fed locally-sourced
// strings (Decision 10), so a dead AP / wrong password is visible instead of the
// panel silently holding while the cycle repeats (GH #66). The outcome stays
// HttpError, so the sleep/retry policy is unchanged.
static void renderWifiErrorScreen(const WifiResult& wifi) {
    Serial.printf("wifi-error: \"%s\" — %s\n", wifi.ssid, wifi.reason);
    char detail[PROBLEM_DETAIL_CAP];
    snprintf(detail, sizeof(detail), "Could not connect to \"%s\".\n%s", wifi.ssid, wifi.reason);
    renderErrorScreen("No Wi-Fi connection", detail, nullptr);
}

// Map a fetched response onto the ADR-0003 / ADR-0011 / ADR-0013 outcome table:
// render the error screen or flush the frame as a side effect, and return the
// outcome that drives the sleep policy. The arm decision itself is net.h's pure
// classifyResponse() — host-tested, including the 304-before-body ordering.
static CycleResult dispatchResponse(const HttpResponse& r) {
    switch (classifyResponse(r)) {
        case ResponseArm::Transport:
            return CycleResult::HttpError;  // transport failure — panel untouched (#47)
        case ResponseArm::NotModified:
            Serial.println("frame: 304 unchanged — skipping panel flush (ADR-0013)");
            return CycleResult::NotModified;  // unchanged-frame skip — panel keeps its frame
        case ResponseArm::WorkerError:
            renderWorkerError(r);  // reachable non-2xx — error screen
            return CycleResult::WorkerError;
        case ResponseArm::BodyTooLarge:
            Serial.printf("body: exceeds %u byte cap\n", (unsigned)MAX_COMPRESSED_BYTES);
            return CycleResult::BodyTooLarge;
        case ResponseArm::Frame:
            return handleFrameResponse(r);  // 200 OK — frame to panel
    }
    return CycleResult::HttpError;
}

// Apply an ADR-0013 bookkeeping decision to the RTC-backed ETag, keeping the
// invariant "storedEtag names the frame the panel shows" true. newEtag is the
// response's ETag (consulted only on Store).
static void applyEtagAction(EtagAction action, const char* newEtag) {
    switch (action) {
        case EtagAction::Store:
            strlcpy(storedEtag, newEtag, sizeof(storedEtag));
            Serial.printf("etag: stored %s\n", storedEtag);
            break;
        case EtagAction::Clear:
            if (storedEtag[0] != '\0') {
                Serial.println("etag: cleared — next wake sends no If-None-Match");
            }
            storedEtag[0] = '\0';
            break;
        case EtagAction::Keep:
            break;
    }
}

// ---------- Wake path ----------

// Bring up the serial link and log the wake banner. The wake counter (RTC-backed)
// bumps here so the banner reports it.
//
// The 1 s CDC re-attach delay (the S3's native USB CDC powers down in deep sleep
// and re-enumerates on wake; prints fired before the host re-attaches are lost)
// is gated (GH #89): kept on cold boot — you just plugged in and are probably
// watching — but on a timer wake it costs ~1 s of active current every cycle for
// nothing unless someone is on the port, so it is opt-in via RADIATOR_DEBUG.
static void announceWake() {
    Serial.begin(115200);
    if (RADIATOR_DEBUG || esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_UNDEFINED) {
        delay(1000);  // let the host re-attach the CDC after the wake re-enumeration
    }

    wakeCount++;
    Serial.println();
    Serial.printf("=== GottaGo wake cycle #%lu — wake reason: %s ===\n", (unsigned long)wakeCount,
                  wakeReasonStr(esp_sleep_get_wakeup_cause()));
}

// Allocate the per-cycle PSRAM scratch. False on exhaustion — the caller then
// sleeps on the firmware fallback and retries next wake. Re-allocated every
// cycle because deep sleep wipes the heap on wake anyway.
static bool allocateScratchBuffers() {
    compressedBuf = (uint8_t*)heap_caps_malloc(MAX_COMPRESSED_BYTES, MALLOC_CAP_SPIRAM);
    inflatedBuf   = (uint8_t*)heap_caps_malloc(EXPECTED_BMP_BYTES, MALLOC_CAP_SPIRAM);
    uzlibDict     = (uint8_t*)heap_caps_malloc(UZLIB_DICT_BYTES, MALLOC_CAP_SPIRAM);
    return compressedBuf && inflatedBuf && uzlibDict;
}

void setup() {
    const uint32_t wakeStart = millis();

    announceWake();

    // Panel bring-up first. Every sleep path now drops the panel rail via
    // epd_poweroff_all() in sleepFor() (GH #80) — including the alloc-failure
    // exit below — so the driver must be initialized before any sleepFor() call.
    epd_init();

    // No recovery if scratch can't be allocated — sleep on the firmware
    // fallback and try again next wake.
    if (!allocateScratchBuffers()) {
        Serial.println("PSRAM alloc failed — sleeping on firmware fallback");
        sleepFor(CycleResult::HttpError, {false, 0}, millis() - wakeStart, wakeCount);
    }

    // Sample the battery every wake, strictly before Wi-Fi: GPIO 14 is ADC2,
    // which the radio owns once up (GH #79). ~10 ms of already-awake CPU.
    const uint32_t batteryMv = sampleBatteryMv();

    SleepHeader sleep   = {false, 0};
    CycleResult outcome = CycleResult::HttpError;

    const WifiResult wifi = connectWiFi();
    if (wifi.connected) {
        const HttpResponse r =
            fetchFrame(compressedBuf, MAX_COMPRESSED_BYTES, batteryMv, storedEtag);
        sleep   = r.sleep;
        outcome = dispatchResponse(r);
        applyEtagAction(chooseEtagAction(panelStateAfter(outcome), r.etag[0] != '\0'), r.etag);
    } else {
        renderWifiErrorScreen(wifi);  // show why, instead of silently holding (#66)
        // The error screen replaced the frame, so the stored ETag is no longer
        // the truth — clear it (ADR-0013 rule 3) even though the outcome stays
        // HttpError for the sleep policy (#66). panelStateAfter() can't see
        // this screen: there is no HttpResponse on this arm.
        applyEtagAction(chooseEtagAction(PanelState::ErrorScreen, false), nullptr);
    }
    disconnectWiFi();  // drop the radio before sleeping

    sleepFor(outcome, sleep, millis() - wakeStart, wakeCount);
}

void loop() {
    // Unreachable: esp_deep_sleep_start() in setup() never returns.
}
