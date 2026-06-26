/**
 * problem.{h,cpp} — the radiator's error-screen module (ADR-0011).
 *
 * Parses an RFC 9457 application/problem+json body into a ProblemDoc, resolves
 * it (plus the verbose flag) into a drawable ErrorScreen via the ADR-0011
 * fallback rules, and renders that to the panel. renderErrorScreen() is a
 * neutral drawing primitive — plain strings in, no problem-doc / HTTP type —
 * so the Wi-Fi-down (#66) and transport-failure (#129) arms reuse it for the
 * worker-unreachable cases with locally-sourced strings.
 *
 * Extracted from radiator.ino per GH #63 (first translation-unit split). The
 * ArduinoJson parser and the bundled FiraSans font are implementation details
 * of this module — they no longer leak into the sketch's includes.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

// Problem-document display caps (ADR-0011). title/detail are short
// Worker-authored strings; upstream_detail is verbose-only and capped — the
// panel clips any overflow.
static const size_t PROBLEM_TITLE_CAP    = 64;
static const size_t PROBLEM_DETAIL_CAP   = 256;
static const size_t PROBLEM_UPSTREAM_CAP = 512;

// Diagnostics-footer caps (ADR-0014). A formatted X-Server-Time line
// ("2026-05-23 06:48 UTC") and a "~5 min" next-check token are both short; the
// assembled footer holds the slug/version/ssid/time/next-check clauses on a few
// wrapped lines. The panel clips any overflow.
static const size_t DIAG_TIME_CAP   = 24;
static const size_t DIAG_NEXT_CAP   = 16;
static const size_t DIAG_FOOTER_CAP = 192;

// A parsed problem+json document (RFC 9457 / ADR-0011). Only the three string
// fields the firmware renders are lifted; type/instance/status[as-int] feed the
// generic fallback message but are not drawn. Empty title/detail signal a parse
// failure to resolveErrorScreen(), which then falls back to the generic screen.
struct ProblemDoc {
    int httpStatus;
    char title[PROBLEM_TITLE_CAP];
    char detail[PROBLEM_DETAIL_CAP];
    char upstream[PROBLEM_UPSTREAM_CAP];
    bool hasUpstream;
};

// A problem document resolved (+ verbose flag) into the three strings the panel
// draws. title/detail are owned copies (they carry the fallbacks). upstream
// ALIASES the source ProblemDoc::upstream buffer when shown, else nullptr — so
// an ErrorScreen must not outlive the ProblemDoc it was resolved from.
struct ErrorScreen {
    char title[PROBLEM_TITLE_CAP];
    char detail[PROBLEM_DETAIL_CAP];
    const char* upstream;
};

// Locally-sourced diagnostic identity drawn in the error-screen footer (GH #61,
// ADR-0014): which radiator, on which AP, on which firmware, when it failed, and
// when it next retries. Passed IN (never reached out for) so the Wi-Fi-down (#66)
// and transport-failure (#129) arms supply the same fields from local sources —
// the renderer stays neutral. Any field may be null/empty: the renderer omits
// that clause (e.g. serverTimeIso is empty on a transport/Wi-Fi failure, which
// carries no X-Server-Time). All pointers must outlive the render call.
struct ErrorDiag {
    const char* slug;             // RADIATOR_SLUG
    const char* ssid;             // the AP we are on / tried
    const char* firmwareVersion;  // FIRMWARE_VERSION
    const char* serverTimeIso;    // X-Server-Time (ISO-8601 UTC); empty if absent
    uint32_t nextCheckSeconds;    // chosen next-wake delay (chooseSleep().seconds)
};

// Format an ISO-8601 UTC timestamp ("2026-05-23T06:48:12.000Z") into a glanceable
// "2026-05-23 06:48 UTC" by slicing minute precision — no on-device timezone DB
// (ADR-0014). Writes "" for an empty, too-short, or ill-formed input. Pure.
void formatServerTime(const char* iso, char* out, size_t cap);

// Format a next-wake delay into a short human token: "~5 min" (rounded) at or
// above a minute, else "45 s". Pure — the transport arm and the footer share it.
void formatNextCheck(uint32_t seconds, char* out, size_t cap);

// Assemble the diagnostics footer as a single " | "-joined line from diag
// (slug | version | ssid | [error time |] next-check), omitting any field whose
// source is empty. Pure — host-testable.
void buildDiagFooter(const ErrorDiag& diag, char* out, size_t cap);

// Parse a problem+json body (json[0..len)) into doc's string fields. doc's
// httpStatus is set by the caller beforehand. On any parse failure — empty
// body, malformed JSON, missing members — the string fields are left empty so
// resolveErrorScreen() falls back to the generic screen (Decision 8).
void parseProblem(const char* json, size_t len, ProblemDoc* doc);

// Apply the ADR-0011 fallback rules to a parsed problem document: empty title →
// "Unexpected error", empty detail → a generic "HTTP <status>" line, and
// upstream shown only when verbose && doc.hasUpstream. Pure — no panel I/O, so
// the policy is host-testable. The returned ErrorScreen aliases doc (see above).
ErrorScreen resolveErrorScreen(const ProblemDoc& doc, bool verbose);

// Render a generic error screen: a warning glyph + title as the heading, detail
// as the body, (when non-null) upstreamOrNull underneath, and a diagnostics
// footer built from diag (ADR-0014). Neutral content in, panel out (Decision 10)
// — the Wi-Fi-down (#66) and transport-failure (#129) arms reuse this with
// locally-sourced strings (including their own diag) for the worker-unreachable
// cases.
void renderErrorScreen(const char* title, const char* detail, const char* upstreamOrNull,
                       const ErrorDiag& diag);

// Common-path entry for a Worker error response: parse a problem+json body
// (json[0..len), already de-gzipped by the caller), resolve it against httpStatus
// + verbose, and render the screen — one call instead of the parseProblem →
// resolveErrorScreen → renderErrorScreen trilogy. The ProblemDoc/ErrorScreen
// pair (and its aliasing lifetime, see ErrorScreen above) stays contained here.
// An empty/unparseable body resolves to the generic screen (Decision 8). diag
// supplies the footer (ADR-0014). The lower-level seams remain public for the
// #66/#129 reuse and host tests.
void renderProblemScreen(const char* json, size_t len, int httpStatus, bool verbose,
                         const ErrorDiag& diag);
