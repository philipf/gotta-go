# Product Requirements Document (PRD): GottaGo
**Version:** 0.4  
**Previous version:** [v0.3](Metlink%20PRD%20v0.3.md)  
**Language reference:** [glossary.md](../glossary.md) — every term in this document is defined there.

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

### 5.1 `priority_split` layout

The **frame** is divided into a **global header** (~8% of height) and a **content area** below it. The content area holds either one or two **columns**, depending on the number of **transit targets** in the active **profile phase**. Two columns are split by a hairline rule.

#### Global header
- **Wall-clock time** (24-hour `HH:MM`) — centred, small pixel font.

#### Per-column layout (top to bottom)

| # | Section | Approx. height | Content |
| --- | --- | --- | --- |
| 1 | **Column header** | ~20% | **Mode icon** stacked above **route code** (e.g. bus icon over `22`, train icon over `HVL`). |
| 2 | **Tier 1 — Leave In** | ~40% | Hero pixel-font value under the `LEAVE IN` label. Renders minutes (e.g. `7 MIN`) or the literal **`NOW`** when Leave In reaches zero. |
| 3 | **Tier 2 — Leave By + Arrives** | ~15% | `BY hh:mm` (the leave deadline) above `ARRIVES n MIN · hh:mm` (the paired **Arrives In** and **arrival time**). |
| 4 | **Track + marker** | ~10% | Horizontal **track** representing a fixed **window**. The **marker** sits at a position computed from **leave margin** (§5.3). Marker hard-right = **Now**. |
| 5 | **Tier 3 — Next service** | ~15% | `NEXT hh:mm` — the fallback service. Renders `—` if no next service is available. |

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
- No transit data, no marker. The Worker bypasses all Metlink API and KV cache calls for this layout.

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

### 5.4 Typography

All text and the **mode icons** render in **Press Start 2P** (bundled as a static Worker asset). Recommended sizes:
- Tier 1 hero (Leave In value): ~120 px
- Mode icon / route code: ~24 px
- Tier 2 (BY + ARRIVES + arrival time): ~16 px
- Tier 3 (NEXT): ~14 px
- Global header (wall-clock): ~20 px

See [GottaGo — UI/UX Reference](../UI/GottaGo%20%E2%80%94%20UI_UX%20Design%20Reference.md) for screen scenarios and weight-band guidance.

---

## 6. Functional requirements (EARS format)

* **While** the active **profile phase** has two **transit targets**, the Worker **shall** render the `priority_split` layout split evenly into two columns (one per transit target).
* **While** the active profile phase has one transit target, the Worker **shall** render the `priority_split` layout with a single full-width column.
* **While** the active profile phase selects `minimal_clock`, the Worker **shall** render the `minimal_clock` layout and **shall not** issue any Metlink API or KV cache requests.
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
* **When** a radiator requests a frame, the Worker **shall** query the **KV cache** first.
* **When** the KV cache entry is older than 30 seconds, the Worker **shall** issue a single request to the Metlink GTFS-Realtime API, update the cache, and return the frame to protect API rate limits.
* **When** the active layout is `minimal_clock`, the Worker **shall** bypass the KV cache and Metlink API entirely and return a clock frame immediately.
* **When** the rendering pipeline executes, the Worker **shall** render layout elements using **Satori** (for Press Start 2P font rendering and CSS-based layout) and encode the final output as a flattened 1-bit monochrome BMP byte array at 960×540 via manual BMP byte construction, optimised for direct native flushing by the LilyGO T5 panel.

### Power management & lifecycle
* **While** operating in an active commute profile phase, the radiator **shall** wake from deep sleep, flush the frame, and return to sleep per the **sleep duration** in `X-Sleep-Seconds` (typically 2–3 minutes).
* **While** operating in an inactive afternoon or idle profile phase, the radiator **shall** increase its deep sleep duration to 30 minutes to preserve battery health.

### Error handling
* **When** a radiator cannot reach the Worker (Wi-Fi failure, network error, or unexpected response), the radiator **shall** take no action — the panel retains its last valid frame indefinitely without power. The radiator **shall** silently retry on the next scheduled wake cycle.

### Pre-implementation spikes required
* ~~The specific Metlink GTFS-Realtime API endpoints, response shapes, and field mappings for bus stop predictions (`stop_id`) and train station departures (`station_id`) must be validated against the live API before Worker implementation begins.~~ **Complete** — see [`docs/adr/0002-metlink-stop-predictions-field-mapping.md`](../adr/0002-metlink-stop-predictions-field-mapping.md). Key finding: the API uses `stop_id` for both bus and train; a `service_id` filter must be applied client-side in the Worker.
* The TypeScript BMP rendering pipeline must be validated end-to-end in a Cloudflare Workers environment before full Worker implementation begins. The spike must confirm: Satori rendering with the Press Start 2P TTF asset produces pixel-accurate output at the required sizes; the manual 1-bit BMP encoder correctly encodes the rasterised pixel data; and the resulting BMP byte stream is faithfully flushed by the LilyGO T5 EPD panel without artefacts.

## 8. High-level architecture & solution design

The system follows a **"Dumb Radiator, Smart Edge"** architectural pattern. The radiator's firmware performs zero data processing, JSON parsing, schedule evaluation, or layout maths. Instead, it offloads all computational and rendering complexity to the Cloudflare **Worker**, which determines the active **profile phase** from server time, computes transport timelines, and returns a raw, ready-to-flash 1-bit bitmap **frame** alongside the **sleep duration**.

### Technology stack
* **Edge compute:** Cloudflare Workers (TypeScript).
* **Caching layer:** Cloudflare KV Storage (30-second TTL for Metlink API responses).
* **Graphics engine:** **Satori** for CSS-driven layout and Press Start 2P font rendering (TTF bundled as a static Worker asset), producing an intermediate SVG. The SVG pixel data is encoded into a 1-bit monochrome BMP byte array via manual BMP byte construction — zero native dependencies, sub-millisecond encode time.
* **Firmware:** C++/Arduino ESP-IDF framework running on the LilyGO T5 (handles Wi-Fi connection, HTTP fetching, deep sleep management, and raw E-paper EPD buffer flushing).
* **External data:** Metlink Wellington Open Data API (GTFS-Realtime predictions). API specification: [`docs/metlink-api-swagger.json`](../../docs/metlink-api-swagger.json). Field mapping and rate-limit analysis: [`docs/adr/0002-metlink-stop-predictions-field-mapping.md`](../adr/0002-metlink-stop-predictions-field-mapping.md).

### Request / response contract

The authoritative wire contract — paths, headers, status codes, response shapes, value ranges — is the OpenAPI 3.1 specification at [`docs/api/openapi.yaml`](../api/openapi.yaml). The rationale behind every choice (path versioning, indistinguishable auth failures, the reserved `X-Radiator-*` namespace, idle-profile fall-through, etc.) is captured in [ADR-0003](../adr/0003-radiator-worker-contract.md). This section gives the PRD-level surface only — there are no field-level details here that are not in the OpenAPI.

**Endpoint shape.** A single call: `GET /v1/frame`. The radiator identifies itself via `X-Radiator-Slug` and authenticates with the shared `X-Radiator-Token`; the Worker returns a gzipped 1-bit 960×540 BMP **frame** and the next **sleep duration** in `X-Sleep-Seconds`. All future radiator-side telemetry (battery, firmware version, Wi-Fi RSSI) reserves the `X-Radiator-*` header prefix, so firmware can add it later without a Worker change or a contract version bump.

**Error model.** The Worker never errors on "no active profile phase" — server time outside every configured window falls through to the **idle profile** and returns `200`. Likewise, a Metlink outage with any cached data (even past TTL) is served as a `200` with a `stale-served` cache-status header rather than a `502`. The radiator's response to every status code is the same shape: flush the frame if `200`, ignore the body otherwise, and sleep for `X-Sleep-Seconds` (or the firmware's 300-s fallback when no response arrived).

### Profile-phase resolution flow (Worker)
1. Validate `X-Radiator-Token`.
2. Look up the `X-Radiator-Slug` value in the `radiators:` config → resolve to a **profile**.
3. Convert server UTC time to `global.timezone`.
4. Match current time against the profile's phase `start_time` / `end_time` ranges → determine the active **profile phase**.
5. If the phase selects `minimal_clock`: render the clock frame and return immediately (no Metlink call).
6. If the phase selects `priority_split`: check KV cache → fetch Metlink if stale → render the frame.
7. Return BMP + `X-Sleep-Seconds`.

## 9. Relevant configuration files

### Master configuration (`config.yaml`)

```yaml
# Global platform configurations
global:
  timezone: "Pacific/Auckland"
  default_refresh_interval_minutes: 3

# Radiator registry.
# Maps a radiator slug (sent via X-Radiator-Slug) to a profile.
# The slug is hardcoded as a compile-time constant in each radiator's firmware.
radiators:
  bedroom-philip-tania:
    profile: "philip_and_tania"
  bedroom-daughter:
    profile: "daughter_school"
  # Add additional radiator entries here (up to 5 total).

# Profiles — each profile has multiple profile phases.
profiles:
  philip_and_tania:
    morning_commute:
      start_time: "06:30"
      end_time: "09:00"
      refresh_interval_minutes: 2
      layout: "priority_split"
      transit_targets:
        bus:
          stop_id: "3234"         # Westchester Dr at Waitohi Rd — validated ADR-0002
          service_id: "1"         # Route 1 to Island Bay
          time_to_stop_mins: 7   # Walking — predictable, low variance
          comfort_buffer: 3
        train:
          stop_id: "TAKA1"        # Takapu Rd Station (KPL line) — validated ADR-0002
          service_id: "KPL"       # Kāpiti Line
          time_to_stop_mins: 15  # Driving — subject to traffic variance
          comfort_buffer: 4

    workday_focus:
      start_time: "09:00"
      end_time: "16:00"
      refresh_interval_minutes: 1   # 1-minute ticks for desk-clock accuracy
      layout: "minimal_clock"

    evening_return:
      start_time: "16:00"
      end_time: "19:00"
      refresh_interval_minutes: 3
      layout: "priority_split"      # Single-column auto-scales for one target
      transit_targets:
        train:
          stop_id: "WELL1"        # Wellington Station (KPL line outbound) — not yet live-validated
          service_id: "KPL"       # Kāpiti Line
          time_to_stop_mins: 10
          comfort_buffer: 4

  daughter_school:
    morning_school_run:
      start_time: "07:15"
      end_time: "08:30"
      refresh_interval_minutes: 2
      layout: "priority_split"
      transit_targets:
        bus:
          stop_id: "TBD"          # Daughter's school bus stop — not yet validated
          service_id: "TBD"       # Route TBD
          time_to_stop_mins: 5
          comfort_buffer: 3

    afternoon_idle:
      start_time: "08:30"
      end_time: "21:00"
      refresh_interval_minutes: 30  # Aggressive battery conservation
      layout: "minimal_clock"
```

### Cloudflare Worker manifest (`wrangler.toml`)

```toml
name = "gottago-worker"
main = "src/worker.ts"
compatibility_date = "2026-05-16"

kv_namespaces = [
    { binding = "TRANSIT_CACHE", id = "prod_metlink_cache_kv_id_here" }
]

[env.production.vars]
METLINK_API_URL = "https://api.opendata.metlink.org.nz/v1"

# Secrets — never stored in this file.
# Set once via CLI before first deployment:
#   wrangler secret put METLINK_API_KEY
#   wrangler secret put RADIATOR_SHARED_TOKEN
```

## 10. Deployment checklist

Before first deployment, complete in order:

- [ ] Run BMP rendering spike: validate Satori + Press Start 2P TTF output and manual 1-bit BMP encoder against the LilyGO T5 EPD panel (see §7).
- [x] Validate Metlink API endpoints for `stop_id` (bus and train) — confirmed field names, response shapes, and rate-limit behaviour. See ADR-0002.
- [ ] Create the Cloudflare KV namespace and replace `prod_metlink_cache_kv_id_here` in `wrangler.toml` with the real ID.
- [ ] Set Worker secrets: `wrangler secret put METLINK_API_KEY` and `wrangler secret put RADIATOR_SHARED_TOKEN`.
- [ ] Bundle Press Start 2P TTF as a static Worker asset.
- [ ] Flash each radiator's firmware with its assigned **radiator slug** (matching an entry in `radiators:`) and the `RADIATOR_SHARED_TOKEN` value as compile-time constants.
- [ ] Deploy Worker: `wrangler deploy`.

## 11. Deferred / future work

* **Battery level indicator:** Requires the radiator to pass its current charge level as a query parameter to the Worker. Deferred to a future version to keep the firmware simple and maintain the dumb-radiator contract.
* **Battery life validation for `workday_focus`:** The 1-minute refresh cycle during a 7-hour workday on a 2000 mAh LiPo has not been empirically validated. If battery drain is unacceptable, options are: increase the refresh interval, show date only, or remove the workday clock feature.
