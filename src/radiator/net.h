/**
 * net.{h,cpp} — the radiator's Wi-Fi + HTTP transport and body I/O (ADR-0003,
 * ADR-0008). Owns the whole network surface: Wi-Fi association, the one wake
 * request (TLS, the HTTP/1.0 downgrade, the AC-F1 headers, header collection),
 * draining the response body, and gzip inflation of a drained body.
 *
 * fetchFrame() returns the raw facts of the response (status, body bytes,
 * truncation, content-encoding, the validated sleep directive); the wake-cycle
 * orchestrator in radiator.ino maps those onto the ADR-0003/0011 response table.
 * Device-only (HTTPClient/TLS), so it is not part of the host test build —
 * inflateGzip's correctness is covered by the on-panel happy-path verify.
 *
 * Extracted from radiator.ino per GH #63 (the #1 transport/content split, with
 * the #3 body-I/O relocation folded in).
 */
#pragma once

#include <cstddef>
#include <cstdint>

#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "sleep.h"  // SleepHeader, parseSleepSecondsValue

// Compressed body sanity bound. Headroom over the ~525 B observed on
// minimal_clock; if a future frame profile exceeds this we'll need streaming
// inflate (see ADR-0008 reversal trigger). Keeping it small keeps the PSRAM
// allocation honest and surfaces growth early.
static const size_t MAX_COMPRESSED_BYTES = 8192;

// uzlib needs a small dictionary for sliding-window matches.
static const size_t UZLIB_DICT_BYTES = 32768;

// The raw outcome of one wake request. status <= 0 is a transport failure / no
// response (the panel-untouched arm); otherwise it is the HTTP status. body* and
// gzipped describe the drained body in the caller's buffer; sleep is the parsed
// X-Sleep-Seconds directive (honoured even on a non-2xx).
struct HttpResponse {
    int         status;
    size_t      bodyLen;
    bool        truncated;  // body filled the buffer (cap reached)
    bool        gzipped;    // Content-Encoding: gzip
    SleepHeader sleep;
};

// Associate with the configured AP, or return false within WIFI_TIMEOUT_MS so a
// flaky AP can never wedge the cycle.
bool connectWiFi();

// Drop the radio before sleeping.
void disconnectWiFi();

// Perform one wake request, draining the body into buf (capacity cap). See
// HttpResponse for the returned facts. Calls https.end() before returning.
HttpResponse fetchFrame(HTTPClient &https, WiFiClientSecure &client,
                        uint8_t *buf, size_t cap);

// Inflate a gzip stream src[0..srcLen) into dst[0..dstCap) using the caller's
// dictionary scratch. Returns bytes produced, or -1 on any uzlib error. Shared
// by the frame path and the error path (ADR-0008 one-shot inflate).
long inflateGzip(const uint8_t *src, size_t srcLen, uint8_t *dst, size_t dstCap,
                 uint8_t *dict, size_t dictCap);
