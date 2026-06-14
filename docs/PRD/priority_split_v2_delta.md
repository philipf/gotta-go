# `priority_split` v2 — delta overview & requirements

**Status:** resolved delta, ready to merge into the PRD (§5.1, §5.3, §6) and the glossary.
**Scope of this document:** the *why* and the *what*. The *how* (view-model fields, render order, pixel sizing, render-fit tuning) is deliberately out of scope and will be fleshed out separately.
**Language note:** uses glossary terms where they survive; introduces new terms where the redesign needs them (flagged **NEW**).
**Decision status:** the open questions that v1 of this delta carried in §6 are now resolved; see §6 below.

---

## 1. Why

Three findings from dogfooding v1 (the shipped `priority_split`):

1. **The track + marker is unused.** In practice nobody reads the marker to decide anything — the `LEAVE IN` hero already answers "when do I leave?". The track + marker therefore costs ~10% of every column for no decision support.
2. **Choosing the *next* service requires mental math.** It often happens that we decide to skip the imminent service and take the one after — but v1 only renders `LEAVE IN` / `LEAVE BY` for the catchable service. The next service appears in Tier 3 as a bare departure time, so its leave time has to be derived in the head. This is exactly the mental subtraction GottaGo exists to remove.
3. **Running slightly late loses all context.** When we're a minute or two past the leave time, v1 promotes the missed service away and shows nothing about it. We lose the answer to "the one I just missed — when does it actually reach the stop, and can I still make it?".

v2 reclaims the marker's space and spends it on (2) and (3): the next service gets full hero treatment, and the just-missed service gets a compact line.

---

## 2. What changes (structure)

A column stops being a single hero + footnote and becomes an **ordered vertical timeline of one transit target's successive departures**. The slots are **positional** — they are positions in time, *not* catchability buckets — in four bands, top to bottom:

| Slot | **NEW?** | Holds | Content |
| --- | --- | --- | --- |
| **LAST** | NEW | the single most-recently-departed service still short of the stop | one compact line: state tag + negative Leave In + arrival clock |
| **NEXT** | renamed | the **first upcoming** departure (leave_by not yet passed) | hero: `LEAVE IN` value, `BY hh:mm`, `ARR hh:mm` |
| **THEN** | NEW | the **second upcoming** departure | hero, equal weight to NEXT: `LEAVE IN` value, `BY hh:mm`, `ARR hh:mm` |
| **LATER** | renamed | the next departures after THEN | up to `LATER_COUNT` compact lines: `LEAVE IN · ARR` each |

Key deltas vs v1:

- **Slots are positional, not catchability-selected.** v1's NEXT was "the catchable service". v2's NEXT is simply the first upcoming departure on the timeline — which may be **cancelled** (rendered struck, no Leave In). **Catchable service** is retired as the slot selector and survives only as a *property* of a departure (used to tag the LAST row RUN/MISSED).
- **Track + marker removed.** The track, the marker, the **window**, **leave margin**, and the §5.3 marker-position computation are deleted from the layout.
- **NEXT and THEN are co-equal heroes.** Same hero size for both; distinguished only by the `NEXT` / `THEN` tags. Each shows `LEAVE IN`, `LEAVE BY` (clock), and **arrival clock** only — the `ARRIVES IN n MIN` minutes value from v1 Tier 2 is dropped.
- **LATER is a richer list.** v1's chained `NEXT hh:mm → hh:mm → hh:mm` (bare departure clocks) becomes compact rows, each carrying its own `LEAVE IN` and arrival clock.
- **Promotion dissolves.** v1 promoted a missed service out of the column as a state event. v2 re-derives the whole timeline positionally each **wake cycle** from a stateless render, so there is no promotion event to implement — a departure that crosses its leave_by simply appears in LAST on the next frame and the upcoming departures shift up.
- **No new upstream data.** A column is still one `stop_id` + `service_id`; the Stop Predictions response already returns the departure list. v2 just renders more of that list and computes Leave In / Leave By / arrival per departure. No extra Metlink request. Crucially the **LAST row is also sourced from this same single response** (see §3).

---

## 3. NEW concept — the LAST row (just-missed service) and RUN / MISSED

The LAST row shows the **single** most-recently-departed service while it is still *recent enough to matter*, as one line:

```
<RUN | MISSED>   −1 MIN · ARR 08:07
```

It carries a **state tag** with two values:

- **RUN** — you are past your comfortable leave time but the service has not yet reached the stop, so hurrying may still make it. (At `−1 MIN · ARR 08:07` with a 4-min walk, the bus is still 3 minutes from the stop — sprintable.)
- **MISSED** — you are late enough that hurrying will not make it.

Threshold (expressed as *minutes late* = `−leave_in`, always ≥ 0 on this row):

- **RUN** while `minutes_late ≤ RUN_LIMIT`
- **MISSED** while `minutes_late > RUN_LIMIT`

`RUN_LIMIT` defaults to **1 minute** and is overridable per **profile phase**. The boundary is `≤`, so `RUN_LIMIT` reads as *"the largest lateness still sprintable"*: at the default, `−1 MIN` is **RUN** and `−2 MIN` is **MISSED** — matching the mockup.

**Single line only.** When several departures have passed their leave_by but none has yet reached the stop (frequent service + a long walk), the LAST row shows only the **most-recently-departed** one (the one closest to NEXT). Older missables are dropped.

**Floor — when the row hides.** The row is omitted once `now ≥ arrival_time` — the moment the service physically reaches the stop. A bus (4-min walk) therefore shows for ~4 min, a train (8-min walk) for ~8 min.

**Sourced statelessly from the live feed.** The just-missed service's stop arrival is in the *future* for the entire life of the LAST row (`leave_by = arrival_time − time_to_stop`, so the row spans `leave_by → arrival_time`, all of it before the service reaches the stop). It only leaves the Stop Predictions feed at `arrival_time` — exactly when the floor hides the row. So the Worker can derive the LAST row from the **same single response** it already fetches: there is no Metlink "missed" signal, so the Worker owns the *selection* (which departure), the *negative Leave In*, and the *RUN/MISSED tag* — but it needs **no cross-wake-cycle state and no extra request**. The "Dumb Radiator, Smart Edge" posture and the no-cache stance (ADR-0010) are unchanged; no new ADR is required.

> Edge case (does not occur with today's configs): if a target's `time_to_stop_mins` is shorter than its phase refresh interval, the `leave_by → arrival_time` window can be narrower than one wake cycle, so a wake could jump from NEXT straight past the in-feed moment and skip the LAST row. Today's targets (`time_to_stop` 4 / 8 min against a 1-min commute refresh) make this structurally impossible. If it ever became a risk, the fix is a config validation rule (`time_to_stop_mins ≥ refresh interval`), not persisted state.

**Cancelled in the LAST position.** A cancelled service that has crossed its leave_by renders struck (per §4 cancellation handling) with **no RUN/MISSED tag** — it was never catchable, so the tag would be meaningless.

This overturns one v1 invariant: a missed service was previously *removed* before Leave In could go negative. In v2, the most-recent missed service is instead **echoed on the LAST row with a negative Leave In** until the floor hides it.

---

## 4. Functional requirements (EARS draft)

Structure:

- **While** the active **profile phase** uses `priority_split`, the Worker **shall** render each **column** as an ordered vertical timeline of a single **transit target**'s successive departures, in the positional slots **LAST**, **NEXT**, **THEN**, **LATER** (top to bottom), ordered by departure time.
- The Worker **shall not** render a **track** or **marker**; the track, marker, **window**, **leave margin**, and §5.3 marker-position computation are removed from `priority_split`.
- **While** the active profile phase has a single **transit target**, the Worker **shall** render the same four-slot structure in one full-width column (no structural variant).

Slot selection (positional):

- The Worker **shall** place in **NEXT** the first departure whose **Leave By** has not passed, in **THEN** the next such departure, and in **LATER** up to `LATER_COUNT` further departures, all ordered by departure time.
- The Worker **shall** place in **LAST** the single most-recently-departed service whose **Leave By** has passed but which has not yet reached the stop (`now < arrival_time`); when several qualify, only the most recent.

NEXT and THEN (co-equal heroes):

- For the **NEXT** and **THEN** slots, the Worker **shall** render at equal visual weight: the `LEAVE IN` hero value, the `LEAVE BY` clock time (`BY hh:mm`), and the **arrival clock** time (`ARR hh:mm`).
- The Worker **shall not** render the `ARRIVES IN n MIN` minutes value in either hero slot.
- **When** **Leave In** for the NEXT slot reaches zero, the Worker **shall** render the literal `NOW` as that slot's hero value under the unchanged `LEAVE IN` label (unchanged from v1 Now behaviour). `NOW` only ever appears in NEXT, since the next departure to cross leave_by is always the NEXT slot.

LATER:

- For the **LATER** slot, the Worker **shall** render up to `LATER_COUNT` further departures, each as a single compact line of `LEAVE IN` minutes and **arrival clock** time (`n MIN · hh:mm`).
- **When** fewer than `LATER_COUNT` departures follow THEN within the 120-minute horizon, the Worker **shall** render only those that exist, and render nothing (or a single `—`) when none follow.

LAST (just-missed service):

- **When** a transit target's most-recently-departed service is within the LAST-row display window (`leave_by` passed and `now < arrival_time`), the Worker **shall** render it as one compact line: the state tag (`RUN` or `MISSED`), the negative **Leave In** (`−n MIN`), and the **arrival clock** time (`ARR hh:mm`).
- **While** the missed service is still catchable by hurrying (`minutes_late ≤ RUN_LIMIT`), the Worker **shall** tag the LAST row `RUN`; **when** it is no longer catchable (`minutes_late > RUN_LIMIT`), the Worker **shall** tag the LAST row `MISSED`.
- **When** `now ≥ arrival_time`, the Worker **shall** omit the LAST row entirely.
- The Worker **shall** derive the LAST row (selection, negative Leave In, RUN/MISSED tag) from the existing single Stop Predictions response, **without** persisting state across wake cycles and **without** any additional Metlink request.

Exception states:

- **When** a departure's `delay` rounds to **+1 minute or more late**, the Worker **shall** compute that departure's Leave In / Leave By / arrival against `arrival.expected` and render a `DELAYED +n MIN` badge on that departure's slot — in **any** slot it occupies.
- **When** a departure's `delay` rounds to **1 minute or more early** (`delay` negative), the Worker **shall** compute that departure's Leave In / Leave By / arrival against `arrival.expected` (earlier than aimed, so **Leave In shrinks** — bad news) and render an `EARLY −n MIN` badge on that departure's slot, in any slot it occupies. *(EARLY is **NEW** — the signed twin of DELAYED.)*
- **When** the Metlink feed reports a cancellation for a departure, the Worker **shall** render that departure in its chronological slot with **strike-through** on its scheduled clock and **no Leave In**, consuming its slot. In a hero slot (NEXT/THEN), the hero value area **shall** show the struck scheduled clock with the `LEAVE IN` label suppressed; the real leave-time number falls to the next live hero below.
- **When** no departure falls within the next **120 minutes**, the Worker **shall** render `NO SERVICE` in the NEXT slot with the next available departure clock time below it, and suppress THEN and LATER; the LAST row **may** still render. Otherwise the Worker **shall** fill the slots with whatever departures fall within the 120-minute horizon, rendering fewer slots when fewer exist.

Promotion (removed):

- The v1 **promotion** rule is removed. The timeline re-derives positionally each **wake cycle** from a stateless render, so there is no promotion event: a departure that crosses its Leave By simply appears in LAST on the next frame and the upcoming departures shift up.

Data (architecture delta, unchanged contract):

- **When** rendering a `priority_split` frame, the Worker **shall** derive `LEAVE IN`, `LEAVE BY`, and **arrival clock** for every rendered departure — including the LAST row — from the existing single Stop Predictions response, and **shall not** issue any additional Metlink request beyond the v1 single call.

Configuration:

- The Worker **shall** remove `comfortBuffer` from the transit-target shape; it had no consumer once the marker was deleted. `RUN_LIMIT` (default 1 min) is settable per profile phase; `LATER_COUNT` (3) is a fixed render constant.

---

## 5. Glossary impact (what to touch — not how)

Removed:

- **Track**, **Marker**, **Window**, **Leave margin** (§5/§6 of the glossary) — delete.
- **§5.3 Marker position** (PRD) — delete.

Retired / redefined:

- **Tier 1 / Tier 2 / Tier 3** and **Next services** → replace with the four **positional slots** **LAST**, **NEXT**, **THEN**, **LATER**. Each slot carries its own weight band (NEXT/THEN co-equal heroes; LAST/LATER compact) — there is no separate "tier" abstraction.
- **Catchable service** — **retired as a slot selector**. It survives only as a *property* of a departure ("can this still be made given time to stop and now?"), which the LAST row uses to choose `RUN` vs `MISSED`.
- **Promotion** — **removed**. Replaced by stateless positional re-derivation each wake cycle (no event).
- **Missed service** — "removed from the column" becomes "echoed on the LAST row with a negative Leave In until `now ≥ arrival_time` hides it".
- **Leave In** invariant — "never negative" becomes "never negative *in the NEXT / THEN / LATER slots*; the LAST row carries a negative Leave In by design".

Added (**NEW**):

- **LAST row** / **just-missed service** — the single most-recently-departed service still short of the stop, echoed as one compact line until the floor hides it.
- **RUN / MISSED** — the two states of the LAST row's tag, split at `RUN_LIMIT` (RUN while `minutes_late ≤ RUN_LIMIT`).
- **Early service** / **`EARLY −n MIN`** — a service running ahead of schedule (negative `delay`). The signed twin of **Delayed service**: where a delay is good news (grows Leave In), an early run is **bad news** (shrinks Leave In — leave sooner). Badged on any slot the early departure occupies.
- **THEN slot** — the second upcoming departure, a co-equal hero beside NEXT.

---

## 6. Decisions (resolved)

The open questions this delta previously carried are now settled:

- **`comfortBuffer` / `leaveMargin` — removed.** Both existed only to size the window and place the marker; with the marker gone they have no consumer. `comfortBuffer` is dropped from the transit-target shape (`config-types.ts` + `data.ts`); `leaveMargin` and the marker math are deleted. `RUN_LIMIT` is a separate, purpose-named parameter (not a repurpose of `comfortBuffer`).
- **Exception-state placement across two heroes — per-slot, everywhere.** DELAYED / EARLY badges render on whichever slot the affected departure occupies (NEXT, THEN, LATER, or LAST). Cancellations render struck in their own chronological slot, including hero slots.
- **`RUN_LIMIT`** — default **1 min**, per-profile-phase override; RUN while `minutes_late ≤ RUN_LIMIT`.
- **`LATER_COUNT`** — **3**, fixed render constant (not per-phase; nothing about a phase changes pixel fit).
- **LAST-row floor** — hide when `now ≥ arrival_time` (coincides with the service leaving the feed).

> **Render-fit follow-up (a *how*, tracked separately):** with `LATER_COUNT = 3`, DELAYED/EARLY badges permitted on every slot, and the LAST row, a column can get dense. The exact sizing/wrapping is out of scope here but **must be verified against a real render** before this ships.

---

## 7. Reference mockup (Direction B + RUN/MISSED)

Weekday-morning peak scenario (10-min bus / 15-min train headways) — the habitat where the LAST row's `−1 MIN` reads naturally. 960×540, 1-bit, DejaVu Sans Bold on the panel.

> Mockup caveats — it predates two resolved decisions and so is illustrative only: it shows **2** LATER rows (the spec is `LATER_COUNT = 3`), and it does **not** depict the `EARLY −n MIN` badge or the per-row service-id prefix used for any-of `serviceId` targets.

```svg
<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg" role="img" width="100%">
<title>GottaGo priority_split v2 — twin services with just-missed line</title>
<rect x="2" y="2" width="956" height="536" fill="#ffffff" stroke="#111111" stroke-width="3"/>
<line x1="2" y1="46" x2="958" y2="46" stroke="#111111" stroke-width="2"/>
<line x1="480" y1="46" x2="480" y2="538" stroke="#111111" stroke-width="1.5"/>
<g font-family="Verdana,'DejaVu Sans',sans-serif" font-weight="700" fill="#111111" text-anchor="middle">
<text x="480" y="33" font-size="26" letter-spacing="1">08:04   Mon 15 Jun</text>

<rect x="96" y="66" width="44" height="24" rx="4" fill="#111111"/>
<rect x="101" y="71" width="14" height="9" fill="#ffffff"/>
<rect x="121" y="71" width="14" height="9" fill="#ffffff"/>
<circle cx="107" cy="93" r="4" fill="#111111"/>
<circle cx="129" cy="93" r="4" fill="#111111"/>
<text x="152" y="90" font-size="24" text-anchor="start" letter-spacing="1">1 · ISLAND BAY</text>

<text x="240" y="120" font-size="17"><tspan font-size="13" letter-spacing="2">RUN  </tspan><tspan font-size="17">−1 MIN · ARR 08:07</tspan></text>
<line x1="60" y1="134" x2="420" y2="134" stroke="#111111" stroke-width="1.5"/>

<text x="240" y="162" font-size="16" letter-spacing="2">NEXT · LEAVE IN</text>
<text x="240" y="208" font-size="46"><tspan font-size="46">9</tspan><tspan font-size="24"> MIN</tspan></text>
<text x="240" y="236" font-size="18" letter-spacing="1">BY 08:13 · ARR 08:17</text>
<line x1="60" y1="256" x2="420" y2="256" stroke="#111111" stroke-width="1.5"/>

<text x="240" y="284" font-size="16" letter-spacing="2">THEN · LEAVE IN</text>
<text x="240" y="330" font-size="46"><tspan font-size="46">19</tspan><tspan font-size="24"> MIN</tspan></text>
<text x="240" y="358" font-size="18" letter-spacing="1">BY 08:23 · ARR 08:27</text>
<line x1="60" y1="378" x2="420" y2="378" stroke="#111111" stroke-width="1.5"/>

<text x="240" y="402" font-size="14" letter-spacing="2">LATER · LEAVE IN / ARRIVES</text>
<text x="240" y="430" font-size="20">29 MIN · 08:37</text>
<text x="240" y="458" font-size="20">39 MIN · 08:47</text>

<rect x="538" y="66" width="38" height="26" rx="5" fill="#111111"/>
<rect x="543" y="71" width="11" height="9" fill="#ffffff"/>
<rect x="560" y="71" width="11" height="9" fill="#ffffff"/>
<circle cx="547" cy="87" r="2" fill="#ffffff"/>
<circle cx="567" cy="87" r="2" fill="#ffffff"/>
<text x="590" y="90" font-size="21" text-anchor="start" letter-spacing="1">KPL · WELLINGTON STATION</text>

<text x="720" y="120" font-size="17"><tspan font-size="13" letter-spacing="2">MISSED  </tspan><tspan font-size="17">−2 MIN · ARR 08:10</tspan></text>
<line x1="540" y1="134" x2="900" y2="134" stroke="#111111" stroke-width="1.5"/>

<text x="720" y="162" font-size="16" letter-spacing="2">NEXT · LEAVE IN</text>
<text x="720" y="208" font-size="46"><tspan font-size="46">13</tspan><tspan font-size="24"> MIN</tspan></text>
<text x="720" y="236" font-size="18" letter-spacing="1">BY 08:17 · ARR 08:25</text>
<line x1="540" y1="256" x2="900" y2="256" stroke="#111111" stroke-width="1.5"/>

<text x="720" y="284" font-size="16" letter-spacing="2">THEN · LEAVE IN</text>
<text x="720" y="330" font-size="46"><tspan font-size="46">28</tspan><tspan font-size="24"> MIN</tspan></text>
<text x="720" y="358" font-size="18" letter-spacing="1">BY 08:32 · ARR 08:40</text>
<line x1="540" y1="378" x2="900" y2="378" stroke="#111111" stroke-width="1.5"/>

<text x="720" y="402" font-size="14" letter-spacing="2">LATER · LEAVE IN / ARRIVES</text>
<text x="720" y="430" font-size="20">43 MIN · 08:55</text>
<text x="720" y="458" font-size="20">58 MIN · 09:10</text>
</g>
</svg>
```

The two columns intentionally show both LAST states at once: bus = `RUN` (−1 min, sprintable), train = `MISSED` (−2 min, gone).
