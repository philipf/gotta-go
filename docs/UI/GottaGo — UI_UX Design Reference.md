# GottaGo — Screen Design Specification

> **UI/UX Design Reference · Companion to [PRD v0.4](../PRD/GottaGo%20PRD%20v0.4.md)**  
> **Language reference:** every term in this document is defined in [glossary.md](../glossary.md). The PRD and this reference share one ubiquitous language.

The canonical visual and interaction reference for the GottaGo radiator. This document supersedes the layout sketches in [PRD §5](../PRD/GottaGo%20PRD%20v0.4.md) and should be read alongside it. All **frames** render at native 960×540, landscape, 1-bit monochrome.

| Field | Value |
| --- | --- |
| Status | For UI build |
| Panel | LilyGO T5 4.7" |
| Resolution | 960×540 · 1-bit |
| Typeface | DejaVu Sans Bold ([ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md)) |

---

## 1. The thinking behind the UI & UX

The radiator is glanced at, never operated. Every design decision below follows from one question: *what does a tired person crossing a room at 7am need to know in under a second?*

Standard transit apps answer "when does the bus arrive?" That forces mental arithmetic — subtract the **time to stop**, subtract the time you've been standing there, decide whether to move. The radiator removes that maths entirely. It answers the only question that triggers an action: **when do I need to leave the house?** That's **Leave In**, the Tier 1 hero. **Arrives In** is still shown, but as supporting detail, not the headline.

The frame is information-sparse by design. It is mounted on a fridge or a bedside surface, read peripherally, and refreshes only every 2–3 minutes. That rules out anything requiring focus or motion to interpret. The hierarchy is strictly three tiers, and a glance should resolve the top tier alone.

### Action over event
The hero number is **Leave In**, not **Arrives In**. The frame tells you what to do, not what to calculate.

### Three-tier glance
**Tier 1**: Leave In. **Tier 2**: the Leave By / Arrives detail block. **Tier 3**: the **next service** fallback. Each tier is unmistakably lighter than the one above.

### Direction, not level
The **track + marker** is a marker travelling left→right, never a fill. A moving marker reads as "time passing"; a fill reads ambiguously as filling *or* draining.

### Disruption is news, not error
A **delayed service** buys you time — it is shown as a positive shift, not a warning. A **cancelled service** is shown by striking the cancelled service in place so the change is explained, never hidden.

### Every number is labelled
Up to four times can appear at once (wall-clock, Leave By, Arrival time, Next). Each carries a glyph or prefix — `LEAVE IN`, `BY`, `ARRIVES`, `NEXT` — so none can be mistaken for another.

### Mixed by design
Text renders in **DejaVu Sans Bold** (a smooth proportional face), while the **mode icons** stay custom-drawn 8-bit pixel art. The mix is intentional, not a placeholder: icons read as *symbols*, text reads as *data*. This reverses the earlier all-Press-Start-2P aesthetic — see [ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md) for why (the mono pixel font's fixed advance caused headsign and hero fit failures).

---

## 2. Screen scenarios

Four canonical **screens**. Each uses the same column system; the differences are entirely in which state the column resolves to. All four are shown at true 632px-scaled fidelity.

### 2.1 Main — two-target morning commute

*`morning_commute` profile phase · two **transit targets** · `priority_split` layout*

![Main screen — two-target commute, bus and train side by side](GottaGo_Main.jpeg)

**What it shows.** The primary screen. Two equal columns: bus left, train right, split by a hairline rule. Each column is the full three-tier stack.

- **Column header** — custom 8-bit **mode icon** stacked above the **route code**.
- **Tier 1 (LEAVE IN)** — the hero countdown. Bus reads **`NOW`** (go); train reads **`7 MIN`**.
- **Tier 2 (BY 07:08)** — with **`ARRIVES IN 4 MIN · 07:14`** beneath: the leave deadline above the paired **Arrives In** and **arrival time**.
- **Track + marker** — the fixed-**window** track. The marker travels left→right; hard-right means **Now**.
- **Tier 3 (NEXT 07:24)** — the quietest element, below the separator.

### 2.2 Single — school run

*`morning_school_run` profile phase · one transit target · `priority_split` auto-scales to a single column*

**What it shows.** A single-target profile phase auto-scales the same layout to one full-width column — no divider, no second target. The **mode icon** and **route code** enlarge to use the recovered width; the three-tier hierarchy and the **track + marker** are otherwise identical to a single Main column.

This is the daughter's dedicated bus-only stream: one service, zero clutter, the same mental model as the parents' frame so nothing has to be re-learned.

### 2.3 Cancelled service

*Exception · strike-through in place*

**What it shows.** The train's scheduled 07:19 is **struck through** directly above the active **replacement service**. The strike-through alone carries the meaning — no `CANCELLED` text, no divider — so the reason for the changed timings is obvious without clutter.

- The replacement service drives Tier 1 and the marker. Lots of **leave margin** here, so the marker sits near the left.
- **`NEXT 07:48`** stays visible — the third option if the replacement also fails.
- The unaffected bus column is untouched, so the contrast itself signals which side has the disruption.

### 2.4 Delayed service

*Exception · positive shift*

![Delayed service — train delayed +9 min, bus column unaffected](GottaGo_CancelAndDelayed.jpeg)

**What it shows.** A delay is **good news** — it buys you time — so it is never an error state. A bordered **`DELAYED +9 MIN`** banner explains *why* the **Leave By** moved later, the **Leave In** grows, and the marker slides back toward the left to show the recovered **leave margin** at a glance.

The bus column is unaffected. Reading the two columns together, the frame says: "relax about the train, but the bus still needs you now."

---

## 3. Build guidance — do & don't

Hard-won decisions from design iteration. Treat the "don't" column as regressions to avoid — most were tried and rejected for specific reasons.

### Do

- Render every glyph on the **1-bit grid** — pure black on the panel background, no anti-aliasing or grey.
- Keep the **three-tier weight gap** obvious: Tier 1, Tier 2, Tier 3 must each be visibly lighter than the last.
- Use the **marker on the track** for progress. The marker moves left→right; hitting the right cap = **Now**.
- Keep the **window** fixed so the marker's apparent speed is always the same — users learn the rate.
- Label **every** time: clock glyph for **wall-clock time**, `LEAVE IN` for the countdown, `BY` for the leave deadline, `ARRIVES` for the service, `NEXT` for the fallback.
- Strike through a **cancelled service** in place above its **replacement service** — show what changed, don't silently swap it.
- Frame a **delayed service** as a positive shift with the explanatory banner.
- Snap the pixel icons to whole device pixels at final BMP size.
- Leave the last good frame on screen on network failure (the **panel** holds with no power).

### Don't

- Don't use a **filled/draining bar** — "is it filling or emptying?" was the original confusion and is banned.
- Don't make the hero an **unlabelled number** — "4 MIN" of *what* was the core defect this spec fixes.
- Don't lead with **Arrives In** — it forces the mental subtraction the radiator exists to remove.
- Don't add **NOW / LEAVE end-labels** to the track — they reintroduced ambiguity; the motion is the meaning.
- Don't treat a **delayed service** as an error (no warning iconography) — it is time gained.
- Don't **hide a cancelled service** by jumping straight to the next — the change becomes inexplicable.
- Don't invert the column or render a separate `LEAVE NOW` banner — the literal `NOW` value under the unchanged `LEAVE IN` label is enough.
- Don't introduce **greys, gradients or anti-aliasing** — the panel is 1-bit; they render as dither mud.
- Don't let **Next** compete with the Tier 2 detail block — it is a footnote, not a third headline.
- Don't animate or expect smooth motion — frames are 2–3 min apart; the marker *jumps*, like a clock hand.
- Don't introduce a second *text* typeface — DejaVu Sans Bold only. The 8-bit mode icons are the one deliberate exception ([ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md)).

---

*GottaGo — UI/UX Reference · Companion to [PRD v0.4](../PRD/GottaGo%20PRD%20v0.4.md) §5.*
