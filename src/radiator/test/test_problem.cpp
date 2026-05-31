// Host-native tests for the problem module (ADR-0011). These characterise the
// behaviour locked in by GH #63's first TU split; going forward, new logic in
// this module (and the net/frame/sleep modules to come) is written test-first.
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "problem.h"

#include <cstdio>
#include <cstring>

// Build a ProblemDoc the way the firmware does — via snprintf into the caps —
// so truncation behaviour matches the real parse path.
static ProblemDoc makeDoc(const char *title, const char *detail,
                          const char *upstream, int status) {
    ProblemDoc d{};
    d.httpStatus = status;
    std::snprintf(d.title, sizeof(d.title), "%s", title);
    std::snprintf(d.detail, sizeof(d.detail), "%s", detail);
    if (upstream && upstream[0]) {
        std::snprintf(d.upstream, sizeof(d.upstream), "%s", upstream);
        d.hasUpstream = true;
    }
    return d;
}

// ---------- resolveErrorScreen (pure fallback rules) ----------

TEST_CASE("resolveErrorScreen passes a fully-populated doc straight through") {
    ProblemDoc d = makeDoc("Radiator not authorised", "Your token was rejected.", "", 401);
    ErrorScreen es = resolveErrorScreen(d, false);
    CHECK(std::strcmp(es.title, "Radiator not authorised") == 0);
    CHECK(std::strcmp(es.detail, "Your token was rejected.") == 0);
    CHECK(es.upstream == nullptr);
}

TEST_CASE("resolveErrorScreen falls back to a generic title when title is empty") {
    ProblemDoc d = makeDoc("", "Something specific.", "", 500);
    ErrorScreen es = resolveErrorScreen(d, false);
    CHECK(std::strcmp(es.title, "Unexpected error") == 0);
    CHECK(std::strcmp(es.detail, "Something specific.") == 0);
}

TEST_CASE("resolveErrorScreen synthesises an HTTP-status detail when detail is empty") {
    ProblemDoc d = makeDoc("Boom", "", "", 502);
    ErrorScreen es = resolveErrorScreen(d, false);
    CHECK(std::strcmp(es.detail,
                      "The display service returned an error (HTTP 502).") == 0);
}

TEST_CASE("resolveErrorScreen gates upstream on the verbose flag") {
    ProblemDoc d = makeDoc("Transit data unavailable", "Metlink is down.",
                           "504 Gateway Timeout", 502);

    SUBCASE("hidden when not verbose") {
        ErrorScreen es = resolveErrorScreen(d, false);
        CHECK(es.upstream == nullptr);
    }
    SUBCASE("shown — and aliasing the doc, not copied — when verbose") {
        ErrorScreen es = resolveErrorScreen(d, true);
        REQUIRE(es.upstream != nullptr);
        CHECK(std::strcmp(es.upstream, "504 Gateway Timeout") == 0);
        CHECK(es.upstream == d.upstream);  // documents the lifetime contract
    }
}

TEST_CASE("resolveErrorScreen never shows upstream when the doc carries none") {
    ProblemDoc d = makeDoc("Internal error", "Oops.", "", 500);
    ErrorScreen es = resolveErrorScreen(d, true);  // verbose, but no upstream present
    CHECK(es.upstream == nullptr);
}

// ---------- parseProblem (ArduinoJson-backed) ----------

TEST_CASE("parseProblem lifts title/detail/upstream from a problem+json body") {
    const char *json =
        "{\"type\":\"https://errors/metlink-unavailable\","
        "\"title\":\"Transit data unavailable\",\"status\":502,"
        "\"detail\":\"Upstream timed out.\","
        "\"upstream_detail\":\"504 Gateway Timeout\"}";
    ProblemDoc d{};
    d.httpStatus = 502;
    parseProblem(json, std::strlen(json), &d);
    CHECK(std::strcmp(d.title, "Transit data unavailable") == 0);
    CHECK(std::strcmp(d.detail, "Upstream timed out.") == 0);
    REQUIRE(d.hasUpstream);
    CHECK(std::strcmp(d.upstream, "504 Gateway Timeout") == 0);
}

TEST_CASE("parseProblem omits upstream when the member is absent") {
    const char *json = "{\"title\":\"Radiator not authorised\",\"detail\":\"Bad token.\"}";
    ProblemDoc d{};
    parseProblem(json, std::strlen(json), &d);
    CHECK(std::strcmp(d.title, "Radiator not authorised") == 0);
    CHECK_FALSE(d.hasUpstream);
}

TEST_CASE("parseProblem leaves fields empty on malformed JSON (generic-fallback signal)") {
    const char *json = "{not valid json";
    ProblemDoc d{};
    parseProblem(json, std::strlen(json), &d);
    CHECK(d.title[0] == '\0');
    CHECK(d.detail[0] == '\0');
    CHECK_FALSE(d.hasUpstream);
}

TEST_CASE("parseProblem on an empty body yields the generic-fallback signal") {
    ProblemDoc d{};
    parseProblem("", 0, &d);
    CHECK(d.title[0] == '\0');
    CHECK(d.detail[0] == '\0');
    CHECK_FALSE(d.hasUpstream);
}

// resolveErrorScreen composed on top of a parse failure → the generic screen.
TEST_CASE("an empty body resolves to the generic error screen") {
    ProblemDoc d{};
    d.httpStatus = 401;
    parseProblem("", 0, &d);
    ErrorScreen es = resolveErrorScreen(d, true);
    CHECK(std::strcmp(es.title, "Unexpected error") == 0);
    CHECK(std::strcmp(es.detail,
                      "The display service returned an error (HTTP 401).") == 0);
    CHECK(es.upstream == nullptr);
}
