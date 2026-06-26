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

// Map the wl_status_t observed when association gives up onto a short, panel-
// ready cause. The common timeout cases (idle / still-disconnected) collapse to
// "timed out"; the distinct ones (AP missing, auth rejected) get their own line
// so a wrong SSID or password reads differently from a flaky signal.
static const char* wifiStatusReason(wl_status_t status) {
    switch (status) {
        case WL_NO_SSID_AVAIL:
            return "Network not found.";
        case WL_CONNECT_FAILED:
            return "Wrong password or authentication failed.";
        case WL_CONNECTION_LOST:
            return "Connection lost.";
        default:
            return "Connection timed out.";
    }
}

WifiResult connectWiFi() {
    Serial.printf("Wi-Fi: connecting to \"%s\"\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    const uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - t0) < WIFI_TIMEOUT_MS) {
        delay(100);
    }
    const wl_status_t status = WiFi.status();
    if (status != WL_CONNECTED) {
        const char* reason = wifiStatusReason(status);
        Serial.printf("Wi-Fi: FAILED within %lu ms (status=%d: %s)\n",
                      (unsigned long)WIFI_TIMEOUT_MS, (int)status, reason);
        return {false, WIFI_SSID, reason};
    }
    Serial.printf("Wi-Fi: connected in %lu ms — IP %s, RSSI %d dBm\n",
                  (unsigned long)(millis() - t0), WiFi.localIP().toString().c_str(), WiFi.RSSI());
    return {true, WIFI_SSID, nullptr};
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
static size_t drainBody(HTTPClient& https, uint8_t* buf, size_t cap, bool* truncated) {
    WiFiClient* stream       = https.getStreamPtr();
    const int expectedSize   = https.getSize();  // -1 when server omits Content-Length
    size_t total             = 0;
    *truncated               = false;
    const uint32_t readStart = millis();
    while ((millis() - readStart) < 10000) {
        while (stream->available() && total < cap) {
            buf[total++] = (uint8_t)stream->read();
        }
        if (total >= cap) {
            *truncated = true;
            break;
        }
        if (expectedSize != -1 && total >= (size_t)expectedSize)
            break;
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

long inflateGzip(const uint8_t* src, size_t srcLen, uint8_t* dst, size_t dstCap, uint8_t* dict,
                 size_t dictCap) {
    uzlib_init();
    TINF_DATA d;
    memset(&d, 0, sizeof(d));
    d.source         = src;
    d.source_limit   = src + srcLen;
    d.source_read_cb = NULL;

    uzlib_uncompress_init(&d, dict, dictCap);

    const int hdr = uzlib_gzip_parse_header(&d);
    if (hdr != TINF_OK) {
        Serial.printf("inflate: gzip header parse failed (err=%d)\n", hdr);
        return -1;
    }

    d.dest_start = d.dest = dst;
    d.dest_limit          = dst + dstCap;
    const int res         = uzlib_uncompress_chksum(&d);
    // TINF_OK (0) = success while filling dest; TINF_DONE (1) = success with
    // end-of-stream marker observed. Either means dst holds valid inflated
    // bytes. Negative values are real failures.
    if (res != TINF_DONE && res != TINF_OK) {
        Serial.printf("inflate: failed (res=%d, produced=%ld bytes)\n", res, (long)(d.dest - dst));
        return -1;
    }
    return (long)(d.dest - dst);
}

BodyText decodeBodyText(const HttpResponse& r, const uint8_t* body, uint8_t* scratch,
                        size_t scratchCap, uint8_t* dict, size_t dictCap) {
    if (!r.gzipped) {
        return {(const char*)body, r.bodyLen};
    }
    const long produced = inflateGzip(body, r.bodyLen, scratch, scratchCap, dict, dictCap);
    if (produced < 0) {
        Serial.println("problem: gzip inflate failed — generic fallback");
        return {"", 0};
    }
    Serial.printf("problem: inflating gzip body -> %ld bytes\n", produced);
    return {(const char*)scratch, (size_t)produced};
}

// ---------- HTTP fetch ----------

HttpResponse fetchFrame(uint8_t* buf, size_t cap, uint32_t batteryMv, const char* ifNoneMatch) {
    HttpResponse r = {0, 0, false, false, {false, 0}, "", ""};

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
    // The token rides in Authorization so Cloudflare auto-redacts it to
    // ******** in Workers Logs — the legacy X-Radiator-Token was captured in
    // cleartext (GH #121). The X-Radiator-* telemetry headers are kept (CF logs
    // them in cleartext, which is fine — they carry no secret).
    https.addHeader("X-Radiator-Slug", RADIATOR_SLUG);
    https.addHeader("Authorization", String("Bearer ") + RADIATOR_TOKEN);
    https.addHeader("Accept-Encoding", "gzip");
    const String mac = WiFi.macAddress();
    if (mac.length() > 0) {
        https.addHeader("X-Radiator-Hardware-Id", mac);
    }

    // Battery telemetry (GH #79): the wake's pre-Wi-Fi sample in raw mV. 0
    // means "no reading" — omit entirely, mirroring the hardware-id guard
    // (the spec marks the header optional).
    if (batteryMv > 0) {
        https.addHeader("X-Radiator-Battery-Mv", String(batteryMv));
    }

    // Conditional frame request (ADR-0013): echo the stored ETag verbatim so
    // the Worker can answer 304 on unchanged content. No stored ETag (first
    // boot, post-error-screen) → no header → the Worker answers 200 as today.
    if (ifNoneMatch != nullptr && ifNoneMatch[0] != '\0') {
        https.addHeader("If-None-Match", ifNoneMatch);
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
    static const char* kept[] = {"X-Sleep-Seconds", "X-Profile-Phase", "X-Server-Time",
                                 "Content-Encoding", "ETag"};
    https.collectHeaders(kept, sizeof(kept) / sizeof(kept[0]));

    const uint32_t t0    = millis();
    const int status     = https.GET();
    const uint32_t reqMs = millis() - t0;
    r.status             = status;
    r.sleep              = parseSleepSecondsValue(https.header("X-Sleep-Seconds").c_str());

    if (status <= 0) {
        // Capture the transport cause for the on-panel error screen (GH #129):
        // the orchestrator never sees the HTTPClient, so the reason string is
        // resolved here, where errorToString() lives, and carried on the result.
        const String err = HTTPClient::errorToString(status);
        strlcpy(r.reason, err.c_str(), sizeof(r.reason));
        Serial.printf("HTTPS: request failed: %s (%lu ms)\n", err.c_str(), (unsigned long)reqMs);
        https.end();
        return r;
    }
    Serial.printf("HTTPS: status %d, content-length %d, sleep=%s (%lu ms)\n", status,
                  https.getSize(), r.sleep.present ? String(r.sleep.seconds).c_str() : "(missing)",
                  (unsigned long)reqMs);

    // ETag capture (ADR-0013): verbatim — the radiator never inspects it. An
    // over-cap value is treated as absent rather than stored truncated (a
    // truncated validator can never match, yet would be re-sent every wake).
    const String etag = https.header("ETag");
    if (etag.length() > 0 && etag.length() < sizeof(r.etag)) {
        memcpy(r.etag, etag.c_str(), etag.length() + 1);
    } else if (etag.length() >= sizeof(r.etag)) {
        Serial.printf("ETag: %u chars exceeds %u cap — treating as absent\n",
                      (unsigned)etag.length(), (unsigned)sizeof(r.etag));
    }

    // A 304 has no content (RFC 9110 §15.4.5) — return before any body I/O.
    // The Workers runtime appends an incidental Content-Encoding: gzip to even
    // this bodiless response (#73, ADR-0013 §What a 304 carries); leaving
    // gzipped false here keeps those zero bytes away from the inflate path.
    if (status == 304) {
        https.end();
        Serial.println("body: none (304 Not Modified)");
        return r;
    }

    r.gzipped = https.header("Content-Encoding").indexOf("gzip") >= 0;
    r.bodyLen = drainBody(https, buf, cap, &r.truncated);
    https.end();
    Serial.printf("body: %u bytes received (Content-Length=%d, content-encoding=%s)\n",
                  (unsigned)r.bodyLen, https.getSize(), r.gzipped ? "gzip" : "(none)");
    return r;
}
