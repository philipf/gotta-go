# Home Transit Radiator — Screen Design Specification

> **UI/UX Design Reference · Companion to PRD v0.3**

The canonical visual and interaction reference for the e-ink display. This document supersedes the layout sketches in [PRD §5](../PRD/Metlink%20PRD%20v0.3.md) and should be read alongside it. All screens render at native 960×540, landscape, 1-bit monochrome.

| Field | Value |
| --- | --- |
| Status | For UI build |
| Panel | LilyGO T5 4.7" |
| Resolution | 960×540 · 1-bit |
| Typeface | DejaVu Sans Bold ([ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md)) |

---

## 1. The thinking behind the UI & UX

The radiator is glanced at, never operated. Every design decision below follows from one question: *what does a tired person crossing a room at 7am need to know in under a second?*

Standard transit apps answer "when does the bus arrive?" That forces mental arithmetic — subtract the walk time, subtract the time you've been standing there, decide whether to move. The radiator removes that maths entirely. It answers the only question that triggers an action: **when do I need to leave the house?** Arrival time is still shown, but as supporting detail, not the headline.

The display is information-sparse by design. It is mounted on a fridge or a bedside surface, read peripherally, and refreshes only every 2–3 minutes. That rules out anything requiring focus or motion to interpret. The hierarchy is strictly three tiers, and a glance should resolve the top tier alone.

### Action over event

The hero number is "LEAVE IN", not "arrives in". The screen tells you what to do, not what to calculate.

### Three-tier glance

Tier 1: leave countdown. Tier 2: the BY / ARRIVES detail block. Tier 3: the NEXT fallback. Each tier is unmistakably lighter than the one above.

### Direction, not level

The progress widget is a marker travelling left→right, never a fill. A moving marker reads as "time passing"; a fill reads ambiguously as filling *or* draining.

### Disruption is news, not error

A delay is a schedule update — it is shown as a timing shift, not a warning. A cancellation is shown by striking the dead service so the change is explained, never hidden.

### Every number is labelled

Four times can appear at once (clock, leave-by, arrival, next). Each carries a glyph or prefix so none can be mistaken for another.

### Mixed by design

Text renders in **DejaVu Sans Bold** (a smooth proportional face), while the **mode icons** stay custom-drawn 8-bit pixel art. The mix is intentional, not a placeholder: icons read as *symbols*, text reads as *data*. This reverses the earlier all-Press-Start-2P aesthetic — see [ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md) for why (the mono pixel font's fixed advance caused headsign and hero fit failures).

---

## 2. Screen scenarios

Four canonical screens. Each is the same column system; the differences are entirely in which state the column resolves to. All four are shown at true 632px-scaled fidelity.

### 2.1 Main — dual commute

*`MORNING_COMMUTE` · priority split*

![Main screen — dual commute, bus and train side by side](GottaGo_Main.jpeg)

**What it shows.** The primary screen. Two equal columns: bus left, train right, split by a hairline rule. Each column is the full three-tier stack.

- **Header** — custom 8-bit mode icon stacked above the route code.
- **Tier 1 (LEAVE IN)** — the hero countdown. Bus reads **NOW** (go); train reads **7 MIN**.
- **Tier 2 (BY 07:08)** — with **ARRIVES 4 MIN · 07:14** beneath: the leave deadline and the paired relative/exact arrival.
- **Widget** — the fixed-window track. The diamond travels left→right; hard-right means leave now.
- **Tier 3 (NEXT 07:24)** — the quietest element, below the separator.

### 2.2 Single — school run

*`MORNING_SCHOOL_RUN` · auto 1-column*

**What it shows.** A single-mode profile auto-scales the same layout to one full-width column — no divider, no second target. The mode icon and route code enlarge to use the recovered width; the three-tier hierarchy and the diamond track are otherwise identical to a single Main column.

This is the daughter's dedicated bus-only stream: one service, zero clutter, the same mental model as the parents' screen so nothing has to be re-learned.

### 2.3 Cancelled service

*Exception · strike-through*

**What it shows.** The train's scheduled 07:19 is **struck through** directly above the active replacement. The strike-through alone carries the meaning — no "CANCELLED" label, no divider — so the reason for the changed timings is obvious without clutter.

- The replacement service drives Tier 1 and the diamond. Lots of margin here, so the diamond sits near the left.
- **NEXT 07:48** stays visible — the third option if the replacement also fails.
- The unaffected bus column is untouched, so the contrast itself signals which side has the disruption.

### 2.4 Delayed service

*Exception · schedule update*

![Delayed service — train delayed +9 min, bus column unaffected](GottaGo_CancelAndDelayed.jpeg)

**What it shows.** A delay is a **schedule update** — the display reflects actual timing, not a plan. A bordered **DELAYED +9 MIN** banner explains *why* the leave-by moved later, the leave countdown updates, and the diamond slides back toward the left to show the adjusted margin at a glance.

The bus column is unaffected. Reading the two columns together, the screen says: "relax about the train, but the bus still needs you now."

---

## 3. Build guidance — do & don't

Hard-won decisions from design iteration. Treat the "don't" column as regressions to avoid — most were tried and rejected for specific reasons.

### Do

- Render every glyph on the **1-bit grid** — pure black on the panel background, no anti-aliasing or grey.
- Keep the **three-tier weight gap** obvious: the hero, the detail block, then NEXT must each be visibly lighter than the last.
- Use the **diamond-on-a-line** for progress. The marker moves left→right; hitting the right cap = leave now.
- Keep the **window fixed** so the diamond's speed is always the same — users learn the rate.
- Label **every** time: clock glyph for now, **BY** for leave, **ARRIVES** for the service, **NEXT** for the fallback.
- Strike through a **cancelled** service in place — show what changed, don't silently swap it.
- Frame a **delay** as a schedule update with the explanatory banner.
- Snap the pixel icons to whole device pixels at final BMP size.
- Leave the last good frame on screen on network failure (e-ink holds with no power).

### Don't

- Don't use a **filled/draining bar** — "is it filling or emptying?" was the original confusion and is banned.
- Don't make the hero an **unlabelled number** — "4 MIN" of *what* was the core defect this spec fixes.
- Don't lead with **arrival time** — it forces the mental subtraction the radiator exists to remove.
- Don't add **NOW / LEAVE end-labels** to the track — they reintroduced ambiguity; the motion is the meaning.
- Don't treat a **delay as an error** (no warning iconography) — it is time gained.
- Don't **hide a cancelled** service by jumping straight to the next — the change becomes inexplicable.
- Don't introduce **greys, gradients or anti-aliasing** — the panel is 1-bit; they render as dither mud.
- Don't let **NEXT** compete with the detail block — it is a footnote, not a third headline.
- Don't animate or expect smooth motion — frames are 2–3 min apart; the diamond *jumps*, like a clock hand.
- Don't introduce a second *text* typeface — DejaVu Sans Bold only. The 8-bit mode icons are the one deliberate exception ([ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md)).

---

*Home Transit Radiator — UI/UX Reference · Companion to [PRD v0.3](../PRD/Metlink%20PRD%20v0.3.md) §5.*
