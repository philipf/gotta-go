// Host-native tests for the pure X-Sleep-Seconds parser (ADR-0003). Guards the
// strictness contract: anything not a clean in-range integer must signal absent
// so the orchestrator applies the firmware fallback rather than a bad cadence.
#include "doctest.h"

#include "sleep.h"

TEST_CASE("parseSleepSecondsValue accepts a clean in-range integer") {
    SleepHeader s = parseSleepSecondsValue("300");
    CHECK(s.present);
    CHECK(s.seconds == 300u);
}

TEST_CASE("parseSleepSecondsValue accepts the range boundaries") {
    CHECK(parseSleepSecondsValue("1").present);
    CHECK(parseSleepSecondsValue("1").seconds == 1u);
    CHECK(parseSleepSecondsValue("86400").present);
    CHECK(parseSleepSecondsValue("86400").seconds == 86400u);
}

TEST_CASE("parseSleepSecondsValue rejects values outside [1, 86400]") {
    CHECK_FALSE(parseSleepSecondsValue("0").present);       // hot-loop guard
    CHECK_FALSE(parseSleepSecondsValue("86401").present);
    CHECK_FALSE(parseSleepSecondsValue("999999").present);
    CHECK_FALSE(parseSleepSecondsValue("-5").present);
}

TEST_CASE("parseSleepSecondsValue rejects non-integers and trailing garbage") {
    CHECK_FALSE(parseSleepSecondsValue("garbage").present);
    CHECK_FALSE(parseSleepSecondsValue("300x").present);    // trailing junk
    CHECK_FALSE(parseSleepSecondsValue("3.5").present);     // strtol stops at '.'
    CHECK_FALSE(parseSleepSecondsValue("").present);
}

TEST_CASE("parseSleepSecondsValue treats absent/empty as not present") {
    CHECK_FALSE(parseSleepSecondsValue("").present);
    CHECK_FALSE(parseSleepSecondsValue(nullptr).present);
}
