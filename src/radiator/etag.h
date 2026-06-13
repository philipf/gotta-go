/**
 * etag.h — the radiator's stored-ETag policy (ADR-0013).
 *
 * The stored ETag is the radiator's second piece of persistent state after the
 * slug: an opaque validator asserting "the panel currently shows the frame this
 * ETag names". The orchestrator parks it in RTC slow memory (survives deep
 * sleep, zeroed on cold boot — losing it merely costs one redundant redraw),
 * sends it as If-None-Match each wake, and keeps it truthful via the policy
 * here after every cycle.
 *
 * Header-only and pure (like sleep.h's policy half), so the ADR-0013 rules —
 * store only after a successfully flushed 200 (rule 2), clear whenever the
 * panel is drawn with anything other than a frame (rule 3) — are host-tested
 * per ADR-0012 rather than trusted.
 */
#pragma once

#include <cstddef>

#include "sleep.h"  // CycleResult

// Stored-ETag capacity, NUL included. The Worker's validator is W/"<16 hex>"
// (~21 chars; see src/worker/api/etag.ts); 64 leaves headroom for a future
// hash change. net.cpp treats an ETag header that does not fit as absent
// rather than storing it truncated — a truncated validator can never match,
// yet would still be sent (uselessly) on every wake.
static const size_t ETAG_CAP = 64;

// What the panel shows after one wake cycle — the state the ETag bookkeeping
// is actually about. Three states, not seven outcomes: the panel either got
// the new frame, kept whatever it had, or was overdrawn with an error screen.
enum class PanelState {
    FrameFlushed,  // a 200's frame was flushed successfully
    Unchanged,     // panel untouched — still shows the previous content
    ErrorScreen,   // the ADR-0011 error screen was drawn
};

// Map a response-path cycle outcome onto the panel state it leaves behind.
// Response-path only: the Wi-Fi-failure arm (#66) also draws an error screen
// while its outcome stays HttpError, but it never has an HttpResponse — the
// orchestrator passes PanelState::ErrorScreen to chooseEtagAction directly
// there. Pure — host-testable.
inline PanelState panelStateAfter(CycleResult outcome) {
    switch (outcome) {
        case CycleResult::Ok:
            return PanelState::FrameFlushed;
        case CycleResult::WorkerError:
            return PanelState::ErrorScreen;
        case CycleResult::NotModified:    // 304 skip — the panel keeps its frame
        case CycleResult::HttpError:      // transport failure — untouched (#47's arm)
        case CycleResult::BodyTooLarge:   // drain/inflate/decode failures all bail
        case CycleResult::InflateFailed:  //   before any panel write, so the old
        case CycleResult::BmpInvalid:     //   frame (and its ETag) remain the truth
            return PanelState::Unchanged;
    }
    return PanelState::Unchanged;
}

// What to do with the stored ETag after a cycle.
enum class EtagAction {
    Store,  // replace it with the response's ETag
    Keep,   // leave it as is
    Clear,  // forget it — the next wake sends no If-None-Match
};

// The ADR-0013 bookkeeping rules, keyed on the one invariant that matters:
// storedEtag == "the validator of the frame the panel shows".
//
//   FrameFlushed → Store the response's ETag (rule 2's only store point); a
//                  200 without one (a Worker predating #73) clears instead.
//   Unchanged    → Keep. The old frame is still up, so the old validator is
//                  still the truth — covers the 304 skip (rule on the ADR's
//                  304 row), transport failures, and 200s whose body failed
//                  inflate/parse (rule 2's "do not update" half).
//   ErrorScreen  → Clear (rule 3). A stale validator after an error screen
//                  would let a later 304 strand that screen on the panel
//                  forever; clearing forces a 200 redraw next wake.
//
// Pure — host-testable.
inline EtagAction chooseEtagAction(PanelState panel, bool responseHadEtag) {
    switch (panel) {
        case PanelState::FrameFlushed:
            return responseHadEtag ? EtagAction::Store : EtagAction::Clear;
        case PanelState::ErrorScreen:
            return EtagAction::Clear;
        case PanelState::Unchanged:
            return EtagAction::Keep;
    }
    return EtagAction::Keep;
}
