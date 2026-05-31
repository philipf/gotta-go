#include "net.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

extern "C" {
#include "src/uzlib/uzlib.h"
}

#include "settings.h"  // WIFI_SSID, WIFI_PASSWORD, FRAME_URL, RADIATOR_TOKEN, RADIATOR_SLUG

// Wi-Fi association timeout. A flaky AP can never wedge the cycle: the caller
// sleeps for the firmware fallback and tries again next wake.
static const uint32_t WIFI_TIMEOUT_MS = 15000;

// ---------- Wi-Fi ----------

bool connectWiFi() {
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

void disconnectWiFi() {
    WiFi.disconnect(true);
}

// ---------- Body I/O ----------

// Drain the response body into buf (capacity cap). Byte-at-a-time matches the
// wake-cycle-32 pattern and avoids the available()-vs-actual confusion the TLS
// layer's record-sized buffer introduces; we cap on bytes actually received
// (total), never on available(), so a chatty TLS buffer can't spuriously
// truncate. Handles the HTTP/1.0 connection-close path the cloudflared tunnel
// forces. Returns bytes read; sets *truncated when the body filled the buffer.
// The caller (not this helper) calls https.end().
static size_t drainBody(HTTPClient &https, uint8_t *buf, size_t cap, bool *truncated) {
    WiFiClient *stream = https.getStreamPtr();
    const int expectedSize = https.getSize();  // -1 when server omits Content-Length
    size_t total = 0;
    *truncated = false;
    const uint32_t readStart = millis();
    while ((millis() - readStart) < 10000) {
        while (stream->available() && total < cap) {
            buf[total++] = (uint8_t)stream->read();
        }
        if (total >= cap) {
            *truncated = true;
            break;
        }
        if (expectedSize != -1 && total >= (size_t)expectedSize) break;
        if (!https.connected()) {
            // Drain any tail bytes the TLS layer still has buffered after the
            // server closed the connection. Bound by expectedSize when known
            // so a trailing CRLF (or similar) doesn't sneak past.
            delay(20);
            const size_t tailCap = (expectedSize != -1) ? (size_t)expectedSize : cap;
            while (stream->available() && total < tailCap) {
                buf[total++] = (uint8_t)stream->read();
            }
            break;
        }
        delay(1);
    }
    return total;
}

long inflateGzip(const uint8_t *src, size_t srcLen, uint8_t *dst, size_t dstCap,
                 uint8_t *dict, size_t dictCap) {
    uzlib_init();
    TINF_DATA d;
    memset(&d, 0, sizeof(d));
    d.source = src;
    d.source_limit = src + srcLen;
    d.source_read_cb = NULL;

    uzlib_uncompress_init(&d, dict, dictCap);

    const int hdr = uzlib_gzip_parse_header(&d);
    if (hdr != TINF_OK) {
        Serial.printf("inflate: gzip header parse failed (err=%d)\n", hdr);
        return -1;
    }

    d.dest_start = d.dest = dst;
    d.dest_limit = dst + dstCap;
    const int res = uzlib_uncompress_chksum(&d);
    // TINF_OK (0) = success while filling dest; TINF_DONE (1) = success with
    // end-of-stream marker observed. Either means dst holds valid inflated
    // bytes. Negative values are real failures.
    if (res != TINF_DONE && res != TINF_OK) {
        Serial.printf("inflate: failed (res=%d, produced=%ld bytes)\n",
                      res, (long)(d.dest - dst));
        return -1;
    }
    return (long)(d.dest - dst);
}

// ---------- HTTP fetch ----------

HttpResponse fetchFrame(uint8_t *buf, size_t cap) {
    HttpResponse r = {0, 0, false, false, {false, 0}};

    // The TLS client and HTTP session live only for this request — constructed
    // here, torn down on return (https.end() below; client frees its TLS buffers
    // as it leaves scope). The orchestrator never sees them.
    WiFiClientSecure client;
    HTTPClient https;

    // Spike-grade TLS: skip server-cert validation. Production radiator would
    // pin or bundle the CA for the Worker host — out of scope for this tracer,
    // but called out in the README and ADR-0003's Negative consequences list.
    client.setInsecure();

    Serial.printf("HTTPS: GET %s\n", FRAME_URL);
    if (!https.begin(client, FRAME_URL)) {
        Serial.println("HTTPS: begin() failed (bad URL?)");
        return r;  // status 0 → transport failure
    }

    // Force HTTP/1.0 with Connection: close. Avoids two pieces of HTTP/1.1
    // muddle on the cloudflared path: chunked Transfer-Encoding (which hides the
    // body length from HTTPClient) and keep-alive (which makes detecting
    // end-of-body via connection-close unreliable). The body is still gzipped —
    // Accept-Encoding survives the downgrade.
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
    // Content-Length is tracked internally by HTTPClient regardless of this list.
    static const char *kept[] = {"X-Sleep-Seconds", "X-Profile-Phase",
                                 "X-Server-Time", "Content-Encoding"};
    https.collectHeaders(kept, sizeof(kept) / sizeof(kept[0]));

    const uint32_t t0 = millis();
    const int status = https.GET();
    const uint32_t reqMs = millis() - t0;
    r.status = status;
    r.sleep = parseSleepSecondsValue(https.header("X-Sleep-Seconds").c_str());

    if (status <= 0) {
        Serial.printf("HTTPS: request failed: %s (%lu ms)\n",
                      HTTPClient::errorToString(status).c_str(),
                      (unsigned long)reqMs);
        https.end();
        return r;
    }
    Serial.printf("HTTPS: status %d, content-length %d, sleep=%s (%lu ms)\n",
                  status, https.getSize(),
                  r.sleep.present ? String(r.sleep.seconds).c_str() : "(missing)",
                  (unsigned long)reqMs);

    r.gzipped = https.header("Content-Encoding").indexOf("gzip") >= 0;
    r.bodyLen = drainBody(https, buf, cap, &r.truncated);
    https.end();
    Serial.printf("body: %u bytes received (Content-Length=%d, content-encoding=%s)\n",
                  (unsigned)r.bodyLen, https.getSize(), r.gzipped ? "gzip" : "(none)");
    return r;
}
