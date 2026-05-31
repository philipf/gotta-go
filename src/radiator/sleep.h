/**
 * sleep.{h,cpp} — the radiator's sleep policy and deep-sleep step (ADR-0003).
 *
 * This header holds the module's pure, host-testable surface: the SleepHeader
 * type (net's HttpResponse carries it), the strict X-Sleep-Seconds parser, the
 * present-vs-firmware-fallback decision (chooseSleep), the cycle-outcome enum the
 * policy is keyed on (CycleResult), and its log-token map (cycleResultStr). The
 * one device-only piece — sleepFor(), which logs, arms the timer, and enters deep
 * sleep — lives in sleep.cpp so the policy above stays free of the Arduino/ESP
 * stack and the host tests can drive it directly.
 *
 * Extracted from radiator.ino per GH #63 (the #5 sleep seam).
 */
#pragma once

#include <cstdint>
#include <cstdlib>

// X-Sleep-Seconds accept-range. ADR-0003's Worker contract puts sleep_seconds in
// [30, 14400], but the radiator's accept-range is the broader [1, 86400] — any
// integer in that range is a valid Worker directive (e.g. during a staged
// rollout). Values outside the range fall to the firmware default.
static const uint32_t SLEEP_S_MIN = 1;
static const uint32_t SLEEP_S_MAX = 86400;

// Sleep header parser tri-state. Distinct from "missing" because a value of e.g.
// 0 or 999999 from a misbehaving Worker must fall to the fallback, not silently
// clamp.
struct SleepHeader {
    bool present;
    uint32_t seconds;  // valid only when present
};

// Parse a header value into a SleepHeader if it sits cleanly in
// [SLEEP_S_MIN, SLEEP_S_MAX]. Returns { present: false } for any of: null/empty
// string, non-integer, trailing garbage, or out-of-range value. The strictness
// is deliberate per ADR-0003: a Worker that hands us "0" or "garbage" gets the
// firmware fallback, not a 0-second hot loop. Pure — host-testable.
inline SleepHeader parseSleepSecondsValue(const char *raw) {
    if (raw == nullptr || raw[0] == '\0') return {false, 0};
    char *end = nullptr;
    const long parsed = strtol(raw, &end, 10);
    if (end == raw || *end != '\0') return {false, 0};
    if (parsed < (long)SLEEP_S_MIN || parsed > (long)SLEEP_S_MAX) return {false, 0};
    return {true, (uint32_t)parsed};
}

// Firmware fallback sleep duration (seconds). Applied only when no usable
// X-Sleep-Seconds value reached the radiator — see ADR-0003.
static const uint32_t FIRMWARE_FALLBACK_SLEEP_S = 300;

// Outcome of one wake cycle's network + decode work. The sleep policy is driven
// entirely by this enum — see sleepFor() and the ADR-0003/0011 response table in
// radiator.ino. Lives in the sleep module (not the orchestrator) so the policy
// and its log vocabulary sit together.
enum class CycleResult {
    Ok,             // 200 + valid BMP. flushed to panel. sleep = X-Sleep-Seconds.
    HttpError,      // transport failure / no response. panel untouched. (#47's arm)
    WorkerError,    // reachable Worker returned a non-2xx problem doc. error screen rendered.
    BodyTooLarge,   // body exceeded MAX_COMPRESSED_BYTES. panel untouched.
    InflateFailed,  // gzip inflate produced wrong size or returned an error.
    BmpInvalid,     // inflated bytes did not parse as a 960x540 1bpp BMP.
};

// The chosen next-wake delay plus a human label naming which source picked it
// (for the serial log). source points at a string literal — no ownership.
struct SleepDecision {
    uint32_t    seconds;
    const char *source;
};

// Pick the next-wake delay: the validated X-Sleep-Seconds directive when present,
// else the firmware fallback. Pure — host-testable.
inline SleepDecision chooseSleep(SleepHeader sleep) {
    return sleep.present ? SleepDecision{sleep.seconds, "X-Sleep-Seconds"}
                         : SleepDecision{FIRMWARE_FALLBACK_SLEEP_S, "firmware fallback"};
}

// Short log token for a cycle outcome (the ADR-0003 table row that fired). Pure.
inline const char *cycleResultStr(CycleResult outcome) {
    switch (outcome) {
        case CycleResult::Ok:            return "ok";
        case CycleResult::HttpError:     return "http-error";
        case CycleResult::WorkerError:   return "worker-error";
        case CycleResult::BodyTooLarge:  return "body-too-large";
        case CycleResult::InflateFailed: return "inflate-failed";
        case CycleResult::BmpInvalid:    return "bmp-invalid";
    }
    return "?";
}

// Log the cycle outcome + chosen delay, arm the wake timer, and enter deep sleep.
// Device-only and never returns; the pure decision above is what the host tests
// drive. cycle is the wake counter, passed in for the log line. See sleep.cpp.
void sleepFor(CycleResult outcome, SleepHeader sleep, uint32_t awakeMs, uint32_t cycle);
