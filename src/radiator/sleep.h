/**
 * sleep.h — the radiator's sleep-directive vocabulary (ADR-0003).
 *
 * Header-only for now: the shared SleepHeader type (net's HttpResponse carries
 * it; the orchestrator's sleepFor() consumes it) plus the pure parser for the
 * X-Sleep-Seconds wire value. This is the seed of the #5 sleep module — sleepFor
 * and the firmware-fallback policy join it when that lands. Kept header-only so
 * the pure parser is host-testable without dragging in the HTTP stack.
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
