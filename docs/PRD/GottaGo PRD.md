# Product Requirements Document (PRD): GottaGo
**Version:** 0.4
**Language reference:** [glossary.md](../glossary.md) — every term in this document is defined there.

> This is the living PRD.
---

## Changelog from v0.3

- Renamed the product from *Home Transit Radiator* to **GottaGo**. Every physical unit is now a **radiator**; "device" / "client device" are deprecated.
- Replaced the fill-and-drain progress bar with a **marker on a track** (UX-team revision; rationale lives in the UI/UX reference). §5.1 and §5.3 rewritten.
- Made **Leave In** (minutes-until-leave-home) the Tier 1 hero. The legacy "primary countdown" showed *arrival* minutes — that framing forced the mental subtraction the radiator exists to remove. **Arrives In** is now a Tier 2 detail.
- Replaced the **LEAVE NOW** column inversion with a Tier 1 hero value of **`NOW`** under the unchanged `LEAVE IN` label. Dropped the `urgency_filter` config flag — `NOW` is the zero-state of Leave In, not a separate mode.
- Added explicit handling for **cancelled** and **delayed** services (§5.1, §6).
- Renamed config keys, HTTP headers, and Worker secrets to match the glossary:
  - `devices:` → `radiators:`
  - `comfortable_buffer_factor` → `comfort_buffer`
  - `X-Device-User` → `X-Radiator-Slug`
  - `X-Device-Token` → `X-Radiator-Token`
  - `DEVICE_SHARED_TOKEN` → `RADIATOR_SHARED_TOKEN`
- Dropped `show_progress_bar` and `urgency_filter` config flags (both redundant with the chosen layout).
- Renamed `state` (e.g. `morning_commute`) to **profile phase** throughout to remove overload with "transport mode" and state-machine connotations.

### Reconciliation pass (2026-06-13, in-place)

The document had drifted from the shipped Worker as small changes landed. This pass re-grounds it against the code without minting a new version:

- **§9** now points at `src/worker/config/data.ts` as the canonical config (TypeScript, not `config.yaml`) and shows a trimmed excerpt rather than a full, stale mirror. `wrangler.toml` corrected to `wrangler.jsonc`.
- **§5.5** documents the shipped **`dual_month_calendar`** layout (GH #76), which had replaced the `workday_focus` desk clock with no spec; **§6** gains EARS rules for it and for the `idle_jokes` fall-through.
- Cleared stale claims: the Press Start 2P spike text (typeface is **DejaVu Sans Bold**, ADR-0009), the "error model under design" note (settled in ADR-0011), and the dead `workday_focus` battery item.
- Added the ETag/`304` unchanged-frame skip (ADR-0013) and the diagnostics view (ADR-0004) to the §8 contract surface; repaired broken UI/ADR links.
- Removed the former "Deployment checklist" section — deploy/ops procedure is not PRD scope; it lives with the code and the issue tracker.

---

## 1. Problem statement & context

Navigating public-transport apps during a busy morning introduces unnecessary cognitive load. Standard transit apps require manual navigation, fumbling with phones, and active mental calculation of timetables.

When users are fatigued, rushing, or managing varying household schedules, they need a glanceable, ambient view of transit data that factors in their physical proximity to the stop. GottaGo is a zero-intervention information radiator that translates real-time transport data into immediate, context-aware visual cues distributed throughout the home.

## 2. User personas

* **The Commuting Professionals (Philip & Tania):** Need multi-modal transit options (bus and train) tracked simultaneously side-by-side, adapting dynamically across morning commute, workday focus, and evening return profile phases.
* **The School Commuter (Daughter):** Needs a dedicated, simplified, single-target transit stream (bus only) focused on her specific school-run timeline.

## 3. Success factors

* **Zero-intervention UI:** The consumer interface requires no physical interaction to display context-relevant data.
* **Math-free urgency:** A single glance tells the user when to leave home — based on **time to stop** and **comfort buffer** — eliminating mental countdown calculations.
* **Ultra-high scalability:** New radiators can be added to the network without firmware updates when upstream APIs change.
* **High ambient blending:** Enclosures blend into household environments (bedside, fridge) without emitting disruptive light.

## 4. Hardware specification

| Component | Specification | Estimated cost (NZD) |
| --- | --- | --- |
| **Panel & board** | LilyGO T5 Integrated 4.7-inch Electronic Paper (E-ink) Display Board with on-board ESP32-S3. | ~$68.00 |
| **Power source** | Rechargeable Lithium Polymer (LiPo) battery pack (e.g. 2000 mAh). | ~$10.00 |
| **Enclosure & mounting** | Custom 3D-printed chassis with rear recess slots for neodymium magnets. Landscape orientation. | ~$5.00 |
| **Total per radiator** | **Production hardware stack** | **~$83.00 NZD** |

**Panel specification:** Native resolution 960×540 px, landscape. Every rendered **frame** matches this exact resolution for native 1-bit EPD buffer flushing.

## 5. Screen layout specification

This section specifies layout *structure* and *states*. Typeface, element sizing, weight-band guidance, and rendered screen scenarios live in the [GottaGo — UI/UX Reference](../UI/GottaGo%20-%20UI_UX%20Design%20Reference.md).

### 5.1 `priority_split` layout

The **frame** is divided into a **global header** (~8% of height) and a **content area** below it. The content area holds either one or two **columns**, depending on the number of **transit targets** in the active **profile phase**. Two columns are split by a hairline rule.

#### Global header
- **Wall-clock time** (24-hour `HH:MM`) — centred, small pixel font.

#### Per-column layout (top to bottom)

| # | Section | Approx. height | Content |
| --- | --- | --- | --- |
| 1 | **Column header** | ~20% | **Mode icon** stacked above **route code** (e.g. bus icon over `22`, train icon over `HVL`). |
| 2 | **Tier 1 — Leave In** | ~40% | Hero pixel-font value under the `LEAVE IN` label. Renders minutes (e.g. `7 MIN`) or the literal **`NOW`** when Leave In reaches zero. |
| 3 | **Tier 2 — Leave By + Arrives** | ~15% | `BY hh:mm` (the leave deadline) above `ARRIVES IN n MIN · hh:mm` (the paired **Arrives In** and **arrival time**). |
| 4 | **Track + marker** | ~10% | Horizontal **track** representing a fixed **window**. The **marker** sits at a position computed from **leave margin** (§5.3). Marker hard-right = **Now**. |
| 5 | **Tier 3 — Next services** | ~15% | `NEXT hh:mm → hh:mm → hh:mm` — up to three departures after the hero, chained with ` → `. Shrinks to fewer times (or a single `NEXT hh:mm`) when fewer follow; renders `—` if none does. |

#### Exception states

- **Cancelled service** — the cancelled service's scheduled time is rendered with **strike-through** directly above the **replacement service** in the same column. No `CANCELLED` text label — the strike-through carries the meaning.
- **Delayed service** — a bordered `DELAYED +n MIN` banner appears above Tier 2. **Leave In** and **Leave By** are recomputed against the delayed timing, so a delay pushes Leave In *later* and moves the **marker** *left* — the display reflects the updated schedule.
- **Now** — when **Leave In** reaches zero, the Tier 1 hero value renders the literal `NOW`. The column is **not** inverted; no separate banner.
- **No-service state** — when zero **catchable services** exist within 60 minutes, Tier 1 renders `NO SERVICE` with the next available departure clock time below it.

#### Promotion

When the **catchable service** becomes a **missed service** (Leave In passes zero unmade), the **next service** is **promoted** into the catchable slot. The next-service slot then renders `—` until the next wake cycle fetches a fresh next service.

### 5.2 `minimal_clock` layout

Full-screen centred layout:
- **Wall-clock time** — large pixel font (24-hour `HH:MM`), centred.
- **Current date** — smaller pixel font below (e.g. `Fri 16 May`).
- No transit data, no marker. The Worker makes no Metlink API call for this layout.

### 5.3 Marker position

The **marker**'s horizontal position along the **track** is a function of **leave margin** and **window**:

```
leave_margin    = max(0, leave_by_time − now)              # minutes; clamped at 0
window          = time_to_stop_mins × comfort_buffer       # minutes; full track length
position_ratio  = 1 − clamp(leave_margin / window, 0, 1)   # 0 = hard left, 1 = hard right
```

- **`position_ratio = 0`** (hard left) — **leave margin** is at least one full **window**; plenty of time.
- **`position_ratio = 1`** (hard right) — **leave margin** is zero; the hero reads **`NOW`**.

The window length is constant within a profile phase, so the marker's apparent speed is constant — the user learns the rate.

### 5.4 `idle_jokes` layout

The **idle profile**'s ambient content, shown overnight when no **profile phase** is active. Not utility — amusement: a glance is rewarded with a joke rather than woken with bright information.

- **Joke** (left) — a random dad joke from [icanhazdadjoke.com](https://icanhazdadjoke.com/), word-wrapped in DejaVu Sans Bold; the font size steps down as the joke lengthens so short and long jokes both fit.
- **Meme** (right) — a fixed 1-bit line-art face, bundled as a static Worker asset.
- **No wall-clock or date.** The idle **sleep duration** runs until the next phase opens (up to 4 h), so any rendered time would be stale before it is read.
- **Rotation** — a fresh joke is fetched each **wake cycle**; overnight wakes are rare, so the joke is effectively static for hours.
- **Failure mode** — if the joke source is unreachable or returns nothing usable, the Worker returns `502` and the radiator shows the standard error screen (no bundled fallback), consistent with [ADR-0011](../adr/0011-error-contract-problem-details.md).

### 5.5 `dual_month_calendar` layout

A two-month wall calendar shown during the long daytime windows between commutes — it replaced the original `minimal_clock` desk clock for those phases (GH #76). Like `minimal_clock`, it makes **no Metlink API call**.

- **Two month grids**, side by side — the current month and the next month, each Monday-start with blank leading/trailing cells.
- **Today** is highlighted on whichever grid contains it; the other grid carries no highlight.
- **Weekends and public holidays** are shaded. NZ public holidays come from the Nager.Date API (GH #84); see [`docs/api/nager.date.at-public-holidays.yaml`](../api/nager.date.at-public-holidays.yaml).
- **Header** — a single caption line above the grids.
- **Refresh** — the calendar barely changes within a day, so these phases run a long refresh interval (3–4 h). The **sleep duration** is truncated at the next phase boundary so the calendar never delays the following commute, and the ETag/`304` **unchanged-frame skip** (§8, [ADR-0013](../adr/0013-conditional-frame-requests.md)) keeps each wake flash-free.

---

## 6. Functional requirements (EARS format)

* **While** the active **profile phase** has two **transit targets**, the Worker **shall** render the `priority_split` layout split evenly into two columns (one per transit target).
* **While** the active profile phase has one transit target, the Worker **shall** render the `priority_split` layout with a single full-width column.
* **While** the active profile phase selects `minimal_clock`, the Worker **shall** render the `minimal_clock` layout and **shall not** issue any Metlink API requests.
* **While** the active profile phase selects `dual_month_calendar`, the Worker **shall** render the two-month calendar layout and **shall not** issue any Metlink API requests.
* **When** server time falls outside every configured profile phase, the Worker **shall** fall through to the **idle profile**, render the `idle_jokes` layout, and return `200`.
* **When** **Leave In** for a transit target reaches zero, the Worker **shall** render the literal `NOW` as the Tier 1 hero value under the unchanged `LEAVE IN` label. The column **shall not** be inverted and no separate `LEAVE NOW` banner **shall** be rendered.
* **When** the **catchable service** becomes a **missed service**, the Worker **shall** promote the **next service** into the catchable slot. If no next service is available, the next-service slot **shall** render `—`.
* **When** the Metlink feed reports a cancellation for a transit target's catchable service, the Worker **shall** render the cancelled service's scheduled time with strike-through directly above the **replacement service** in the same column.
* **When** the Metlink feed reports a delay on a transit target's catchable service, the Worker **shall** render a bordered `DELAYED +n MIN` banner above Tier 2 and **shall** recompute **Leave In** and **Leave By** against the delayed timing.
* **When** zero **catchable services** exist within 60 minutes for a transit target, the Worker **shall** render `NO SERVICE` in Tier 1 with the next available departure clock time below it.
* **When** a radiator boots or wakes from deep sleep, the radiator **shall** send its **radiator slug** via `X-Radiator-Slug` and the **shared token** via `X-Radiator-Token`. The Worker **shall** reject requests with a missing or invalid `X-Radiator-Token`.
* **When** the Worker processes a valid request, it **shall** use server-side time (converted to `global.timezone`) to determine the active **profile phase** — no client-side time synchronisation is required.
* **When** the Worker returns a rendered **frame**, it **shall** include an `X-Sleep-Seconds` response header. The radiator **shall** enter deep sleep for exactly this **sleep duration** without any local schedule evaluation.

## 7. Non-functional requirements (EARS format)

### Performance & data fetching
* **When** a radiator requests a frame for a `priority_split` layout, the Worker **shall** issue a request to the Metlink **Stop Predictions** endpoint (`GET /stop-predictions?stop_id=<id>`) and render the returned predictions into the frame. There is **no caching layer** — see [ADR-0010](../adr/0010-no-metlink-cache-layer.md); Metlink runs uncached, which is well within its rate-limit headroom at household scale (see the [Metlink reference](../reference/metlink-stop-predictions.md)).
* **When** the active layout is `minimal_clock`, the Worker **shall** bypass the Metlink API entirely and return a clock frame immediately.
* **When** the rendering pipeline executes, the Worker **shall** render layout elements using **Satori** (for DejaVu Sans Bold font rendering and CSS-based layout) and encode the final output as a flattened 1-bit monochrome BMP byte array at 960×540 via manual BMP byte construction, optimised for direct native flushing by the LilyGO T5 panel.

### Power management & lifecycle
* **While** operating in an active commute profile phase, the radiator **shall** wake from deep sleep, flush the frame, and return to sleep per the **sleep duration** in `X-Sleep-Seconds` (typically 2–3 minutes).
* **While** operating in an inactive afternoon or idle profile phase, the radiator **shall** increase its deep sleep duration to 30 minutes to preserve battery health.

### Error handling
* **When** a radiator cannot reach the Worker (Wi-Fi failure, network error, or unexpected response), the radiator **shall** take no action — the panel retains its last valid frame indefinitely without power. The radiator **shall** silently retry on the next scheduled wake cycle.

### Pre-implementation spikes required
* ~~The specific Metlink Stop Predictions endpoint, response shapes, and field mappings for bus and train must be validated against the live API before Worker implementation begins.~~ **Complete** — see [`docs/reference/metlink-stop-predictions.md`](../reference/metlink-stop-predictions.md). Key findings: GottaGo uses the REST `GET /stop-predictions` endpoint (**not** GTFS-Realtime); a single `stop_id` serves both bus and train; and a `service_id` filter must be applied client-side in the Worker.
* ~~The TypeScript BMP rendering pipeline must be validated end-to-end in a Cloudflare Workers environment before full Worker implementation begins: Satori rendering with the bundled DejaVu Sans Bold TTF asset produces pixel-accurate output at the required sizes; the manual 1-bit BMP encoder correctly encodes the rasterised pixel data; and the resulting BMP byte stream is faithfully flushed by the LilyGO T5 EPD panel without artefacts.~~ **Complete** — validated end-to-end and shipped. Typeface is **DejaVu Sans Bold** per [ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md) (replaced the earlier Press Start 2P pixel font).

## 8. High-level architecture & solution design

The system follows a **"Dumb Radiator, Smart Edge"** architectural pattern. The radiator's firmware performs zero data processing, JSON parsing, schedule evaluation, or layout maths. Instead, it offloads all computational and rendering complexity to the Cloudflare **Worker**, which determines the active **profile phase** from server time, computes transport timelines, and returns a raw, ready-to-flash 1-bit bitmap **frame** alongside the **sleep duration**.

### Technology stack
* **Edge compute:** Cloudflare Workers (TypeScript).
* **Caching layer:** None — the Metlink API is called uncached per frame (see [ADR-0010](../adr/0010-no-metlink-cache-layer.md)).
* **Graphics engine:** **Satori** for CSS-driven layout and DejaVu Sans Bold font rendering (TTF bundled as a static Worker asset; see [ADR-0009](../adr/0009-display-typeface-dejavu-sans-bold.md)), producing an intermediate SVG. The SVG pixel data is encoded into a 1-bit monochrome BMP byte array via manual BMP byte construction — zero native dependencies, sub-millisecond encode time.
* **Firmware:** C++/Arduino ESP-IDF framework running on the LilyGO T5 (handles Wi-Fi connection, HTTP fetching, deep sleep management, and raw E-paper EPD buffer flushing).
* **External data:** Metlink Wellington Open Data API — the REST **Stop Predictions** endpoint (`GET /stop-predictions?stop_id=<id>`), polled once per **wake cycle**; not the GTFS-Realtime feed. API specification: [`docs/metlink-api-swagger.json`](../../docs/metlink-api-swagger.json). Field mapping and rate-limit analysis: [`docs/reference/metlink-stop-predictions.md`](../reference/metlink-stop-predictions.md).

### Request / response contract

The authoritative wire contract — paths, headers, status codes, response shapes, value ranges — is the OpenAPI 3.1 specification at [`docs/api/openapi.yaml`](../api/openapi.yaml). The rationale behind every choice (path versioning, indistinguishable auth failures, the reserved `X-Radiator-*` namespace, idle-profile fall-through, etc.) is captured in [ADR-0003](../adr/0003-radiator-worker-contract.md). This section gives the PRD-level surface only — there are no field-level details here that are not in the OpenAPI.

**Endpoint shape.** A single call: `GET /v1/frame`. The radiator identifies itself via `X-Radiator-Slug` and authenticates with the shared `X-Radiator-Token`; the Worker returns a gzipped 1-bit 960×540 BMP **frame** and the next **sleep duration** in `X-Sleep-Seconds`. All future radiator-side telemetry (battery, firmware version, Wi-Fi RSSI) reserves the `X-Radiator-*` header prefix, so firmware can add it later without a Worker change or a contract version bump.

**Conditional requests.** The Worker returns an `ETag` over the rendered frame; on the next wake a radiator may send `If-None-Match` and receive `304 Not Modified` with no body when the frame is unchanged, skipping both the BMP transfer and the panel flash ([ADR-0013](../adr/0013-conditional-frame-requests.md)). `X-Sleep-Seconds` still drives the next sleep on a `304`.

**Diagnostics.** The same `GET /v1/frame` path serves a JSON diagnostics view (the resolved profile phase and the layout's view model) when the request `Accept`s `application/json` rather than an image ([ADR-0004](../adr/0004-diagnostics-view-content-negotiation.md)).

**Error model.** The Worker never errors on "no active profile phase" — server time outside every configured window falls through to the **idle profile** and returns `200`. Because there is **no caching layer** ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)), a Metlink outage has no stale data to fall back on; the Worker returns an RFC 9457 `problem+json` error (typically `502`) and the radiator shows its standard error screen, per [ADR-0011](../adr/0011-error-contract-problem-details.md). The radiator's response to every status code is the same shape: flush the frame if `200`, ignore the body otherwise, and sleep for `X-Sleep-Seconds` (or the firmware's 300-s fallback when no response arrived).

### Profile-phase resolution flow (Worker)
1. Validate `X-Radiator-Token`.
2. Look up the `X-Radiator-Slug` value in the `radiators:` config → resolve to a **profile**.
3. Convert server UTC time to `global.timezone`.
4. Match current time against the profile's phase `start_time` / `end_time` ranges → determine the active **profile phase**.
5. If the phase selects `minimal_clock`: render the clock frame and return immediately (no Metlink call).
6. If the phase selects `priority_split`: fetch Metlink → render the frame (no cache; see ADR-0010).
7. Return BMP + `X-Sleep-Seconds`.

## 9. Relevant configuration files

### Master configuration (`src/worker/config/data.ts`)

The radiator registry and profiles are **TypeScript**, not YAML — the canonical config is [`src/worker/config/data.ts`](../../src/worker/config/data.ts), typed by [`config-types.ts`](../../src/worker/config/config-types.ts). This is the same posture §8 takes with the OpenAPI spec: point at the source of truth and keep this section to the shape, so the two can't drift. The shape:

- **`global`** — household-wide settings: `timezone`, `defaultRefreshIntervalMinutes`, `stopPredictionLimit` (the upstream Metlink `limit`, set high so a watched service isn't truncated out at a busy shared stop).
- **`profiles`** — named profiles, each an *ordered* list of **profile phases**. The resolver picks the **first** phase whose time window (and optional `days` weekday filter, [ADR-0015](../adr/0015-profile-phase-active-days.md)) matches server time, so array order encodes precedence. A phase carries a `layout`, `refreshIntervalMinutes`, and — for `priority_split` — its `transitTargets`.
- **A transit target** carries `mode`, `stopId`, `serviceId` (one route or an any-of array), `timeToStopMins`, `comfortBuffer`, and optional `destinationStopId` / `destinationNameIncludes` filters that narrow a route branching to several termini at a shared stop, and drop express runs that share route and terminus but skip the rider's station (GH #68 / #77).
- **`radiators`** — maps a **radiator slug** (the `X-Radiator-Slug` header value, hard-coded in firmware) to a profile name.
- **Idle fall-through** — server time outside every phase resolves to the **idle profile** (`idle_jokes`); a profile may override the system default ([ADR-0003](../adr/0003-radiator-worker-contract.md)).

Three radiators ship today: `bedroom-philip-tania` → `philip_and_tania` (morning + afternoon `priority_split`, daytime `dual_month_calendar`), `bedroom-daughter` → `daughter_school` (morning `priority_split`, afternoon `minimal_clock`), and `office-f5` → `philip_office` (all-day `dual_month_calendar` bracketing the afternoon commute, GH #86).

Illustrative excerpt — see `data.ts` for the live values and the rationale comments on each stop/service id:

```ts
export const PROFILES: Record<string, Profile> = {
  philip_and_tania: {
    name: 'philip_and_tania',
    phases: [
      {
        key: 'morning_commute',
        startTime: '05:45',
        endTime: '09:00',
        layout: 'priority_split',
        refreshIntervalMinutes: 1,
        days: ['mon', 'tue', 'wed', 'thu', 'fri'], // Active days (ADR-0015)
        transitTargets: [
          { mode: 'bus',   stopId: '3234',  serviceId: '1',   timeToStopMins: 4, comfortBuffer: 1.5 },
          { mode: 'train', stopId: 'TAKA1', serviceId: 'KPL', timeToStopMins: 8, comfortBuffer: 1.5 },
        ],
      },
      // … afternoon_commute (priority_split) and daytime_calendar (dual_month_calendar)
    ],
  },
  // … philip_office, daughter_school
};
```

### Cloudflare Worker manifest (`wrangler.jsonc`)

The Worker manifest is [`src/worker/wrangler.jsonc`](../../src/worker/wrangler.jsonc) (JSONC, not TOML). It declares the Worker name and entry point, the `.ttf` font-asset data rule, and the `METLINK_API_URL` var. There is **no KV namespace** — the Metlink gateway runs uncached by design ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)). Secrets are never stored in the manifest; set them once via CLI before the first deploy:

```sh
wrangler secret put METLINK_API_KEY
wrangler secret put RADIATOR_SHARED_TOKEN
```

## 10. Deferred / future work

* **Battery level indicator:** Requires the radiator to pass its current charge level as a query parameter to the Worker. Deferred to a future version to keep the firmware simple and maintain the dumb-radiator contract.
* **Battery-life validation:** The 1-minute commute-phase refresh on a 2000 mAh LiPo has not been empirically validated over a full day — most relevant to the always-on `office-f5` radiator, whose `dual_month_calendar` phases run the full weekday. If drain is unacceptable, options are: lengthen the refresh interval, lean harder on the ETag/`304` unchanged-frame skip ([ADR-0013](../adr/0013-conditional-frame-requests.md)), or shorten the active windows.
