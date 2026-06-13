# ADR-0009: Display typeface — DejaVu Sans Bold replaces Press Start 2P

- **Status:** Accepted
- **Date:** 2026-05-30
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md)
- **Related:** [ADR-0005](0005-worker-source-architecture.md) (asset bundling, cold-start budget, vitest sandbox limit), [#40](https://github.com/philipf/gotta-go/issues/40), [#42](https://github.com/philipf/gotta-go/issues/42), [#43](https://github.com/philipf/gotta-go/issues/43)

## Context

The render pipeline (Satori → resvg → 1-bit BMP, [ADR-0005](0005-worker-source-architecture.md)) bundled **Press Start 2P** as the sole typeface for all text. It is a fixed-grid monospace pixel font: every glyph advances exactly 1em and every edge lands on the device-pixel grid, so 1-bit conversion is lossless and layout maths are trivially predictable.

That predictability came at a cost. The 1em/glyph advance is wide, and the `priority_split` layout's two-column SPLIT case puts a hero (`LEAVE IN`) and a service-name header into a ~479px half-pane. The mono metric is the root cause of two recurring fit defects:

- **#40** — long headsigns (`KPL·Wellington Station`) truncated with an ellipsis.
- **#42** — a 2-digit `LEAVE IN` hero (`NN MIN`) overflowed the half-pane and touched the centre rule.

A live font experiment rendered the `72 MIN` / `63 MIN` SPLIT worst case against Liberation Sans Bold, **DejaVu Sans Bold**, and Nimbus Sans Narrow Bold. Proportional digits are ~40% narrower than mono, reclaiming enough horizontal room to fit both the 2-digit hero and the full headsign. Of the candidates, DejaVu Sans Bold had the heaviest strokes and best distance legibility on a 1-bit panel — which matters because, unlike a pixel font, a proportional face leans on grayscale anti-aliasing that gets **hard-thresholded** to 1-bit, worst at small sizes.

The existing aesthetic was deliberate and documented (the UI/UX references state "Press Start 2P only … intentional and cohesive, not a placeholder"). Reversing it, and the new constraints the reversal introduces, is what this ADR records so the decision is not re-litigated.

## Decision

**Replace Press Start 2P with DejaVu Sans Bold as the single bundled typeface** across the whole render pipeline (`shared/satori.ts` and every `features/*/view.tsx`). The change is accompanied by three durable principles.

### 1. The display typeface is DejaVu Sans Bold

- Bundle the **full** stock `DejaVuSans-Bold.ttf` (~709 KB raw / ~354 KB gzipped) — *not* a subset. Full glyph coverage hardens the renderer against unexpected characters in upstream Metlink headsigns (a real glyph instead of a missing-glyph box). The +314 KB gzipped delta over Press Start 2P is well within the Cloudflare 3 MB bundle ceiling; the wasm modules, not the font, dominate the bundle, and cold-start cost is governed by lazy wasm init (ADR-0005), not asset size.
- Register the font at **weight 700** in both `satori()` (`fonts`) and `Resvg` (`fontBuffers` / `defaultFontFamily`); `FAMILY = 'DejaVu Sans'`.
- DejaVu is under a permissive free license. Attribution is recorded in `src/worker/assets/ATTRIBUTION.md`.

### 2. The mixed aesthetic (pixel icons + smooth text) is intentional

The custom 8-bit **mode icons** (`features/priority_split/mode-icon.tsx`, hand-drawn `#`/`.` grids on the device-pixel grid) are **kept as-is**. Blocky pixel icons sitting beside a smooth proportional typeface is a deliberate split — **icons read as symbols, text reads as data**. We are not redrawing the icons to match, and not abandoning them.

This reverses the prior "one typeface, including icons" rule. The retro 8-bit identity of the *text* is given up in exchange for fitting real content; the icon language is retained.

### 3. There is a minimum legible 1-bit font size

Because DejaVu relies on AA that is hard-thresholded to 1-bit, small text can become ragged. We therefore adopt a **floor**: an empirically determined minimum legible size for DejaVu on the 1-bit panel, established during live verification. Per-tier font constants must not drop below the floor; if meeting the floor pushes content out of a pane, the **layout re-flows** — the floor wins over the nominal size. The small tiers (`ARRIVES …`, `NEXT …` at ~13–16px) are where this binds.

### Mechanical consequences of the swap

These follow deterministically and are listed so the implementation is unambiguous:

- All `FULL` / `SPLIT` sizing constants in `priority_split/view.tsx` (hero, labels, `trackW`, `labelMaxW`) and `minimal_clock/view.tsx` (`TIME_SIZE`, `DATE_SIZE`) are **re-tuned for the proportional metric**. The "Press Start 2P advances exactly 1em/glyph" reasoning is removed.
- The headsign keeps its single-line **ellipsis** behaviour; only `labelMaxW` is re-derived so common headsigns render in full and genuinely long ones still truncate (fixed header height preserved).
- The service-name separator is padded to `' · '` (in `priority_split/viewmodel.ts`) — the tight middot existed only because the mono font made padding expensive.

## Consequences

### Positive

- #40 and #42 are resolved at the root rather than by per-case shrinking.
- Full headsigns render legibly; the renderer no longer fails on out-of-set characters.
- Future layout work has a stated rule (the 1-bit size floor) instead of rediscovering small-text legibility every time.

### Negative / follow-ups

- The retro 8-bit *text* identity is gone; the panel now mixes two visual languages by design (principle 2). Anyone expecting the documented "pixel only" look sees a reversal — this ADR is the why.
- 1-bit legibility of proportional small text can only be confirmed **live via `wrangler dev`** (the Satori path is sandbox-blocked in vitest, ADR-0005). There is no automated guard; the verification matrix is the safety net: `leave_in` ∈ {`NOW`, `N MIN`, `NN MIN`} × {FULL, SPLIT} × a long headsign, plus a small-tier legibility read against the floor.
- Largest single bundled asset is now the font. Acceptable today; revisit subsetting only if the bundle ceiling is ever approached.

## References

- [ADR-0005](0005-worker-source-architecture.md) — asset bundling, cold-start budget, vitest sandbox limit on the Satori path.
- [#43](https://github.com/philipf/gotta-go/issues/43) — the implementing issue; [#40](https://github.com/philipf/gotta-go/issues/40) / [#42](https://github.com/philipf/gotta-go/issues/42) — the fit defects that motivated it.
- [`../glossary.md`](../glossary.md), `../UI/*` references, `../PRD/GottaGo PRD v0.4.md` — updated to point here for the typeface decision.
