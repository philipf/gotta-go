// Host-native tests for the pure sleep policy (ADR-0003): the X-Sleep-Seconds
// parser, the present-vs-fallback decision, and the outcome→log-token map. Guards
// the strictness contract — anything not a clean in-range integer signals absent
// so the orchestrator applies the firmware fallback rather than a bad cadence.
#include "doctest.h"

#include "sleep.h"

#include <string>

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

TEST_CASE("chooseSleep honours a present X-Sleep-Seconds directive") {
    const SleepDecision d = chooseSleep({true, 1800});
    CHECK(d.seconds == 1800u);
    CHECK(std::string(d.source) == "X-Sleep-Seconds");
}

TEST_CASE("chooseSleep falls back to the firmware default when absent") {
    const SleepDecision d = chooseSleep({false, 0});
    CHECK(d.seconds == FIRMWARE_FALLBACK_SLEEP_S);
    CHECK(std::string(d.source) == "firmware fallback");
}

TEST_CASE("cycleResultStr maps every outcome to its log token") {
    CHECK(std::string(cycleResultStr(CycleResult::Ok)) == "ok");
    CHECK(std::string(cycleResultStr(CycleResult::NotModified)) == "not-modified");
    CHECK(std::string(cycleResultStr(CycleResult::HttpError)) == "http-error");
    CHECK(std::string(cycleResultStr(CycleResult::WorkerError)) == "worker-error");
    CHECK(std::string(cycleResultStr(CycleResult::BodyTooLarge)) == "body-too-large");
    CHECK(std::string(cycleResultStr(CycleResult::InflateFailed)) == "inflate-failed");
    CHECK(std::string(cycleResultStr(CycleResult::BmpInvalid)) == "bmp-invalid");
}
