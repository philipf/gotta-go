// Host-native tests for the ADR-0013 conditional-request policy: the pure
// response classifier in net.h (a 304 is decided on status alone, before any
// body handling — the #73 trap of an incidental Content-Encoding: gzip on a
// bodiless 304 must never reach the inflate path) and the stored-ETag
// bookkeeping in etag.h (store only after a flushed 200, keep while the panel
// is untouched, clear whenever the panel shows anything other than a frame).
#include "vendor/doctest.h"

#include "etag.h"
#include "net.h"

// An HttpResponse with the fields the classifier reads; sleep/etag stay zeroed.
static HttpResponse makeResponse(int status, bool truncated = false, bool gzipped = false,
                                 size_t bodyLen = 0) {
    HttpResponse r = {status, bodyLen, truncated, gzipped, {false, 0}, "", ""};
    return r;
}

// ---------- classifyResponse ----------

TEST_CASE("classifyResponse: status <= 0 is a transport failure") {
    CHECK(classifyResponse(makeResponse(0)) == ResponseArm::Transport);
    CHECK(classifyResponse(makeResponse(-1)) == ResponseArm::Transport);   // HTTPClient error codes
    CHECK(classifyResponse(makeResponse(-11)) == ResponseArm::Transport);  // read timeout
}

TEST_CASE("classifyResponse: 200 routes to the frame path") {
    CHECK(classifyResponse(makeResponse(200)) == ResponseArm::Frame);
}

TEST_CASE("classifyResponse: 304 is the unchanged-frame skip, not an error") {
    // 304 sits outside 2xx — it must be picked off before the non-2xx arm.
    CHECK(classifyResponse(makeResponse(304)) == ResponseArm::NotModified);
}

TEST_CASE("classifyResponse: a gzip-flagged bodiless 304 still skips — never the inflate path") {
    // The Workers runtime appends an incidental Content-Encoding: gzip to the
    // bodiless 304 whenever the request advertised Accept-Encoding: gzip
    // (#73 / ADR-0013 §What a 304 carries). Routing it through gunzip would
    // fail, render the error screen, and clear the stored ETag — defeating
    // the feature. Status decides; the body flags are never consulted.
    const HttpResponse r = makeResponse(304, /*truncated=*/false,
                                        /*gzipped=*/true, /*bodyLen=*/0);
    CHECK(classifyResponse(r) == ResponseArm::NotModified);
}

TEST_CASE("classifyResponse: 304 wins over the truncation check (it has no body)") {
    CHECK(classifyResponse(makeResponse(304, /*truncated=*/true)) == ResponseArm::NotModified);
}

TEST_CASE("classifyResponse: reachable non-2xx is a Worker error") {
    CHECK(classifyResponse(makeResponse(401)) == ResponseArm::WorkerError);
    CHECK(classifyResponse(makeResponse(404)) == ResponseArm::WorkerError);
    CHECK(classifyResponse(makeResponse(500)) == ResponseArm::WorkerError);
    CHECK(classifyResponse(makeResponse(502)) == ResponseArm::WorkerError);
    CHECK(classifyResponse(makeResponse(301)) ==
          ResponseArm::WorkerError);  // other 3xx are not skips
}

TEST_CASE("classifyResponse: a truncated 200 is BodyTooLarge") {
    CHECK(classifyResponse(makeResponse(200, /*truncated=*/true)) == ResponseArm::BodyTooLarge);
}

// ---------- panelStateAfter ----------

TEST_CASE("panelStateAfter: only Ok flushed a frame") {
    CHECK(panelStateAfter(CycleResult::Ok) == PanelState::FrameFlushed);
}

TEST_CASE("panelStateAfter: both error-screen outcomes drew the error screen") {
    // A reachable non-2xx (ADR-0011) and a transport failure (#129) both overdraw
    // the panel with a local error screen, so each clears the stored ETag below.
    CHECK(panelStateAfter(CycleResult::WorkerError) == PanelState::ErrorScreen);
    CHECK(panelStateAfter(CycleResult::HttpError) == PanelState::ErrorScreen);
}

TEST_CASE("panelStateAfter: every panel-untouched outcome maps to Unchanged") {
    CHECK(panelStateAfter(CycleResult::NotModified) == PanelState::Unchanged);
    CHECK(panelStateAfter(CycleResult::BodyTooLarge) == PanelState::Unchanged);
    CHECK(panelStateAfter(CycleResult::InflateFailed) == PanelState::Unchanged);
    CHECK(panelStateAfter(CycleResult::BmpInvalid) == PanelState::Unchanged);
}

// ---------- chooseEtagAction (the three ADR-0013 rules) ----------

TEST_CASE("chooseEtagAction: a flushed frame stores the ETag it arrived with (rule 2)") {
    CHECK(chooseEtagAction(PanelState::FrameFlushed, true) == EtagAction::Store);
}

TEST_CASE("chooseEtagAction: a flushed 200 without an ETag clears (Worker predating #73)") {
    CHECK(chooseEtagAction(PanelState::FrameFlushed, false) == EtagAction::Clear);
}

TEST_CASE("chooseEtagAction: an untouched panel keeps the stored ETag") {
    // Covers the 304 skip (the stored ETag is still the truth) and a 200 whose
    // body failed inflate/parse — the panel still shows the old frame, so the
    // old validator still names it (rule 2). (A transport failure now overdraws
    // an error screen, so it clears instead — see the ErrorScreen case below.)
    CHECK(chooseEtagAction(PanelState::Unchanged, false) == EtagAction::Keep);
    CHECK(chooseEtagAction(PanelState::Unchanged, true) ==
          EtagAction::Keep);  // 304 repeats the ETag — still keep
}

TEST_CASE("chooseEtagAction: an error screen clears the stored ETag (rule 3)") {
    // The stored ETag asserts "the panel shows the frame this ETag names";
    // once an error screen is up that is false, and a later 304 would strand
    // the error screen forever. Clear forces a 200 redraw on the next wake.
    CHECK(chooseEtagAction(PanelState::ErrorScreen, false) == EtagAction::Clear);
    CHECK(chooseEtagAction(PanelState::ErrorScreen, true) ==
          EtagAction::Clear);  // even if the non-2xx carried one
}
