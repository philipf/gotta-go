#include "problem.h"

#include <Arduino.h>
#include <ArduinoJson.h>

#include "epd_driver.h"
#include "firasans.h"  // bundled FiraSans GFXfont — used by the error screen

// Error-screen layout (FiraSans advance_y = 50 px; panel is 960x540).
static const int32_t ERR_MARGIN_X    = 40;
static const int32_t ERR_MARGIN_TOP  = 70;
static const int32_t ERR_LINE_GAP    = 16;  // extra px between blocks
static const int32_t ERR_WRAP_MAX_PX = EPD_WIDTH - 2 * ERR_MARGIN_X;  // 880

// Cosmetic furniture (ADR-0014), both drawn with the bundled FiraSans — no new
// font needed. ERR_GLYPH is U+2757 (heavy exclamation, in the font's dingbat
// interval 0x2700–0x27BF); ERR_SEPARATOR is a run of U+2500 (box-drawing, in
// 0x2500–0x259F) long enough to span the text column — the panel clips the
// overflow. Typography (bold/smaller) is a separate font-bundling slice.
static const char* ERR_GLYPH     = "❗";
static const char* ERR_SEPARATOR = "──────────"
                                   "──────────"
                                   "──────────"
                                   "──────────";

// ---------- Problem document parse ----------

// title/detail are rendered as heading/body; upstream_detail is lifted only
// when present and non-empty (it rides on metlink-* errors), and shown only
// under the verbose flag (applied later in resolveErrorScreen()).
void parseProblem(const char* json, size_t len, ProblemDoc* doc) {
    doc->title[0]    = '\0';
    doc->detail[0]   = '\0';
    doc->upstream[0] = '\0';
    doc->hasUpstream = false;

    JsonDocument jd;
    const DeserializationError err = deserializeJson(jd, json, len);
    if (err) {
        Serial.printf("problem: parse failed — generic fallback (%s)\n", err.c_str());
        return;
    }

    snprintf(doc->title, sizeof(doc->title), "%s", jd["title"] | "");
    snprintf(doc->detail, sizeof(doc->detail), "%s", jd["detail"] | "");

    const char* up = jd["upstream_detail"] | "";
    if (up[0] != '\0') {
        snprintf(doc->upstream, sizeof(doc->upstream), "%s", up);
        doc->hasUpstream = true;
    }
}

// ---------- Fallback resolution (pure, ADR-0011 Decision 8) ----------

ErrorScreen resolveErrorScreen(const ProblemDoc& doc, bool verbose) {
    ErrorScreen es;
    snprintf(es.title, sizeof(es.title), "%s", doc.title[0] ? doc.title : "Unexpected error");
    if (doc.detail[0]) {
        snprintf(es.detail, sizeof(es.detail), "%s", doc.detail);
    } else {
        snprintf(es.detail, sizeof(es.detail), "The display service returned an error (HTTP %d).",
                 doc.httpStatus);
    }
    es.upstream = (verbose && doc.hasUpstream) ? doc.upstream : nullptr;
    return es;
}

// ---------- Diagnostics footer (pure, ADR-0014; reused by #66/#129) ----------

// Slice an ISO-8601 UTC instant down to glanceable minute precision and stamp it
// UTC — no on-device timezone DB (ADR-0014). "2026-05-23T06:48:12.000Z" becomes
// "2026-05-23 06:48 UTC". Anything not at least "YYYY-MM-DDThh:mm" with a 'T' at
// index 10 (an absent or ill-formed header) yields "".
void formatServerTime(const char* iso, char* out, size_t cap) {
    if (cap == 0)
        return;
    out[0] = '\0';
    if (iso == nullptr || strlen(iso) < 16 || iso[10] != 'T')
        return;
    char trimmed[17];
    memcpy(trimmed, iso, 16);
    trimmed[16] = '\0';
    trimmed[10] = ' ';  // 'T' → space, so "<date> <time>"
    snprintf(out, cap, "%s UTC", trimmed);
}

// "~5 min" (rounded to the nearest minute) at or above a minute, else "45 s".
// Mirrors the next-wake wording the transport arm uses (ADR-0003 fallback).
void formatNextCheck(uint32_t seconds, char* out, size_t cap) {
    if (cap == 0)
        return;
    if (seconds >= 60)
        snprintf(out, cap, "~%lu min", (unsigned long)((seconds + 30) / 60));
    else
        snprintf(out, cap, "%lu s", (unsigned long)seconds);
}

// Append `s` to NUL-terminated `out`, prefixed by `sep` unless `out` is still
// empty (so the separator never leads). Silently no-ops once `out` is full.
static void footerAppend(char* out, size_t cap, const char* sep, const char* s) {
    const size_t len = strlen(out);
    if (len >= cap - 1)
        return;
    if (len == 0)
        snprintf(out, cap, "%s", s);
    else
        snprintf(out + len, cap - len, "%s%s", sep, s);
}

// Assemble the footer as a single " | "-joined line: slug | version | ssid |
// [error time |] next-check. Empty source fields drop their field; an empty
// serverTimeIso (transport/Wi-Fi failure) drops the time but keeps the
// next-check. One line saves vertical space (GH #61 follow-up); the renderer's
// wrapText still folds it to the panel width, and the spaced pipes let it break
// between fields rather than clip a too-long run. Pure.
void buildDiagFooter(const ErrorDiag& diag, char* out, size_t cap) {
    if (cap == 0)
        return;
    out[0] = '\0';

    if (diag.slug && diag.slug[0])
        footerAppend(out, cap, " | ", diag.slug);
    if (diag.firmwareVersion && diag.firmwareVersion[0])
        footerAppend(out, cap, " | ", diag.firmwareVersion);
    if (diag.ssid && diag.ssid[0])
        footerAppend(out, cap, " | ", diag.ssid);

    char when[DIAG_TIME_CAP];
    formatServerTime(diag.serverTimeIso ? diag.serverTimeIso : "", when, sizeof(when));
    if (when[0])
        footerAppend(out, cap, " | ", when);

    char next[DIAG_NEXT_CAP];
    formatNextCheck(diag.nextCheckSeconds, next, sizeof(next));
    char refresh[DIAG_NEXT_CAP + 8];
    snprintf(refresh, sizeof(refresh), "next %s", next);
    footerAppend(out, cap, " | ", refresh);
}

// ---------- Error screen renderer (ADR-0011/0014; reused by #66/#129) ----------

// Width in px of `s` when drawn in `font`, via the library's own measurement.
static int32_t textWidthPx(const GFXfont* font, const char* s) {
    int32_t x = 0, y = 0, x1 = 0, y1 = 0, w = 0, h = 0;
    get_text_bounds(font, s, &x, &y, &x1, &y1, &w, &h, NULL);
    return w;
}

// Greedy word-wrap `in` to maxWidthPx, writing the result into out (capacity
// outCap) with '\n' inserted at wrap points. Honours any '\n' already present
// in `in`. A single word wider than maxWidthPx is emitted as its own line and
// the panel clips the overflow (Decision 6). There is no drop-in wrap library
// for this 16-bit parallel panel (Decision 5) — this ~30-line helper uses the
// measurement get_text_bounds already provides.
static void wrapText(const GFXfont* font, const char* in, char* out, size_t outCap,
                     int32_t maxWidthPx) {
    if (outCap == 0)
        return;
    out[0] = '\0';
    if (outCap < 2)
        return;

    size_t outLen    = 0;
    size_t lineStart = 0;  // index in out where the current line begins
    char cand[PROBLEM_UPSTREAM_CAP + 1];

    size_t i = 0;
    while (in[i] != '\0') {
        if (in[i] == '\n') {  // hard break
            if (outLen < outCap - 1)
                out[outLen++] = '\n';
            lineStart = outLen;
            i++;
            continue;
        }
        if (in[i] == ' ' || in[i] == '\t' || in[i] == '\r') {
            i++;
            continue;
        }

        // Read one word.
        const size_t ws = i;
        while (in[i] && in[i] != ' ' && in[i] != '\t' && in[i] != '\r' && in[i] != '\n') i++;
        const size_t wlen    = i - ws;
        const bool lineEmpty = (outLen == lineStart);

        // Build "current line + (space) + word" into cand and measure it.
        size_t cl = outLen - lineStart;
        if (cl > sizeof(cand) - 1)
            cl = sizeof(cand) - 1;
        memcpy(cand, out + lineStart, cl);
        size_t candLen = cl;
        if (!lineEmpty && candLen < sizeof(cand) - 1)
            cand[candLen++] = ' ';
        size_t copyw = wlen;
        if (candLen + copyw > sizeof(cand) - 1)
            copyw = sizeof(cand) - 1 - candLen;
        memcpy(cand + candLen, in + ws, copyw);
        candLen += copyw;
        cand[candLen] = '\0';

        if (lineEmpty || textWidthPx(font, cand) <= maxWidthPx) {
            // Fits (or forced onto an empty line) — commit cand as the line.
            if (lineStart + candLen <= outCap - 1) {
                memcpy(out + lineStart, cand, candLen);
                outLen = lineStart + candLen;
            }
        } else {
            // Doesn't fit — break and start the word on a fresh line.
            if (outLen < outCap - 1)
                out[outLen++] = '\n';
            lineStart = outLen;
            size_t cw = wlen;
            if (outLen + cw > outCap - 1)
                cw = outCap - 1 - outLen;
            memcpy(out + outLen, in + ws, cw);
            outLen += cw;
        }
    }
    out[outLen] = '\0';
}

// Draws directly to the panel with a NULL framebuffer (the hello-world idiom,
// Decision 4); write_string resets x and advances y per wrapped line, so
// cursor_y already sits below each block on return. Layout top-to-bottom:
// glyph+title, separator, detail, [upstream], separator, diagnostics footer.
void renderErrorScreen(const char* title, const char* detail, const char* upstreamOrNull,
                       const ErrorDiag& diag) {
    Serial.printf("error-screen: render title='%s' upstream=%s\n", title,
                  upstreamOrNull ? "shown" : "hidden");

    const GFXfont* font = (const GFXfont*)&FiraSans;
    char wrapped[PROBLEM_UPSTREAM_CAP + 64];

    epd_poweron();
    epd_clear();  // wipe to avoid ghosting

    int32_t cursor_x = ERR_MARGIN_X;
    int32_t cursor_y = ERR_MARGIN_TOP;

    // Heading: warning glyph + title, then a separator rule.
    char heading[PROBLEM_TITLE_CAP + 8];
    snprintf(heading, sizeof(heading), "%s %s", ERR_GLYPH, title);
    wrapText(font, heading, wrapped, sizeof(wrapped), ERR_WRAP_MAX_PX);
    write_string(font, wrapped, &cursor_x, &cursor_y, NULL);

    cursor_x = ERR_MARGIN_X;
    write_string(font, ERR_SEPARATOR, &cursor_x, &cursor_y, NULL);

    // Body.
    cursor_x = ERR_MARGIN_X;
    cursor_y += ERR_LINE_GAP;
    wrapText(font, detail, wrapped, sizeof(wrapped), ERR_WRAP_MAX_PX);
    write_string(font, wrapped, &cursor_x, &cursor_y, NULL);

    if (upstreamOrNull && upstreamOrNull[0] != '\0') {
        cursor_x = ERR_MARGIN_X;
        cursor_y += ERR_LINE_GAP;
        wrapText(font, upstreamOrNull, wrapped, sizeof(wrapped), ERR_WRAP_MAX_PX);
        write_string(font, wrapped, &cursor_x, &cursor_y, NULL);
    }

    // Diagnostics footer (ADR-0014), under its own separator. Empty only if every
    // diag field is empty — never the case in practice (slug + version always set).
    char footer[DIAG_FOOTER_CAP];
    buildDiagFooter(diag, footer, sizeof(footer));
    if (footer[0] != '\0') {
        cursor_x = ERR_MARGIN_X;
        cursor_y += ERR_LINE_GAP;
        write_string(font, ERR_SEPARATOR, &cursor_x, &cursor_y, NULL);
        cursor_x = ERR_MARGIN_X;
        wrapText(font, footer, wrapped, sizeof(wrapped), ERR_WRAP_MAX_PX);
        write_string(font, wrapped, &cursor_x, &cursor_y, NULL);
    }

    epd_poweroff();
    Serial.println("error-screen: latched");
}

// ---------- Composed common-path entry (ADR-0011) ----------

void renderProblemScreen(const char* json, size_t len, int httpStatus, bool verbose,
                         const ErrorDiag& diag) {
    ProblemDoc doc = {};
    doc.httpStatus = httpStatus;
    parseProblem(json, len, &doc);
    Serial.printf("problem: parsed title='%s' detail_len=%u upstream=%s\n", doc.title,
                  (unsigned)strlen(doc.detail), doc.hasUpstream ? "yes" : "no");

    const ErrorScreen es = resolveErrorScreen(doc, verbose);
    renderErrorScreen(es.title, es.detail, es.upstream, diag);
}
