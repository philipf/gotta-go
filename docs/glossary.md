# GottaGo — Ubiquitous Language

> The shared vocabulary for the GottaGo project. Following Eric Evans' Ubiquitous Language: each concept has exactly one canonical name, and that name is used everywhere — in conversation, in this document, in the PRD, in the UI/UX reference, in `config.yaml`, in the Worker code, in commit messages, in firmware constants.
>
> If you reach for a synonym, fix the glossary. If you can't express something, fix the glossary.
>
> **Single bounded context.** Every term below applies to the whole project — the radiator, the Worker, the config, the firmware. No second dialect.

## How to read this document

Each term carries: the canonical name, a one-line definition, the places it surfaces (UI label, config key, code symbol, prose), invariants where relevant, and an explicit list of rejected synonyms. The rejected list is the contract — it stops drift.

---

## 1. Product & hardware

### GottaGo
The product — the system as a whole.
- **Appears as:** project name, repo name, prose ("the GottaGo system").
- **Not to be confused with:** ~~Home Transit Radiator~~ (legacy name, deprecated), ~~Metlink~~ (the upstream data source, not the product).

### Radiator
One physical unit. There is one radiator per location (bedroom, fridge, kitchen). Identified by a **radiator slug**.
- **Appears as:** prose ("the bedroom radiator"), config key `radiators:`.
- **Not to be confused with:** ~~device~~, ~~client~~, ~~client device~~, ~~unit~~ — all collapse to **radiator**.

### Panel
The e-ink display hardware (LilyGO T5 4.7") inside a radiator. Refers specifically to the screen hardware, not the housing or the on-screen content.
- **Appears as:** prose ("the panel holds the last frame on power loss").
- **Not to be confused with:** **radiator** (the whole unit), **frame** (the on-screen content), ~~e-ink display~~ (legacy phrasing — say "panel").

### Worker
The Cloudflare Worker backend. Resolves the active **profile phase**, fetches Metlink data, renders the **frame**, returns the BMP and the **sleep duration**.
- **Appears as:** prose, `wrangler.toml` config.

---

## 2. Frame structure

### Frame
A single rendered 960×540 1-bit BMP image, produced by the Worker, flushed to the panel each **wake cycle**.
- **Appears as:** prose, code variable.
- **Not to be confused with:** **layout** (the structural template), **screen** (a named example scenario in the UI doc), ~~canvas~~, ~~image stream~~.

### Layout
The structural template a frame uses. Two layouts exist:
- `priority_split` — global header + one or two columns of transit content.
- `minimal_clock` — full-screen wall-clock time.
- **Appears as:** config key `layout:`, prose, code.

### Screen
A named on-screen scenario shown in the UI/UX reference (e.g. "two-target morning commute", "school run", "cancelled service", "delayed service"). A screen is an example of a layout in a particular state — not a layout itself.
- **Appears as:** UI/UX reference §2 only.

### Global header
The top horizontal strip showing **wall-clock time**. Spans the full width of the frame.

### Column
One vertical content pane below the global header. A `priority_split` frame has either one column (full width) or two columns (split by a hairline rule).

### Column header
The per-column heading: a **mode icon** on the left, followed by the **service name** (`service_id · trip_headsign`).

### Mode icon
The custom 8-bit glyph identifying the **mode** (bus or train).
- **Not to be confused with:** ~~vehicle icon~~, ~~service icon~~.

### Service name
The full **column header** label answering "which service is this": the **service id** and the **trip headsign** joined as `service_id · trip_headsign` (e.g. `1·Island Bay`). Composed in the renderer only — it is *not* a wire field; the diagnostics JSON (ADR-0004) carries `service_id` and `trip_headsign` separately. When the headsign is unknown (empty, or a degraded/no-service column) the separator is dropped and the service id shows alone.
- **Appears as:** column-header text (e.g. `1·Island Bay`), to the right of the **mode icon**.
- **Not to be confused with:** ~~route code~~ (legacy, deprecated — an earlier glossary mis-named the header label "route code").

### Trip headsign
The short destination label forming the second part of the **service name** — the human-readable answer to "where is this service going". Sourced from the Metlink `trip_headsign` field and passed through as-is; no synthesis or abbreviation in the Worker.
- **Appears as:** the destination part of the column-header **service name** (e.g. `Island Bay` in `1·Island Bay`), wire field `trip_headsign`, code symbol `tripHeadsign`.

### Service id
The upstream Metlink `service_id` — a route identifier used inside the gateway to filter departures. Also shown to the user as the leading part of the **service name** (the number before the headsign).
- **Appears as:** the leading part of the column-header **service name** (e.g. `1` in `1·Island Bay`), wire field `service_id`, code symbol `serviceId`.
- **Not to be confused with:** ~~route code~~ (legacy, deprecated).

### Tier 1 / Tier 2 / Tier 3
The three weight bands within a column. Each tier must be visibly lighter than the one above.
- **Tier 1** — the **Leave In** hero. Largest, heaviest.
- **Tier 2** — the **Leave By** + **Arrives In** + **arrival time** detail block.
- **Tier 3** — the **Next services** footnote.

---

## 3. Time concepts (the heart of the language)

### Leave In
Minutes until the user must leave home to make the **catchable service**. The Tier 1 hero value. Reads the literal **`NOW`** when zero.
- **Appears as:** UI label `LEAVE IN`, hero value (e.g. `7 MIN`, `NOW`), code symbol `leave_in_mins`.
- **Invariants:** never negative — a **missed service** triggers **promotion** before Leave In can go negative.
- **Not to be confused with:** **Arrives In** (when the *service* reaches the stop, not when *you* must leave).

### Leave By
The absolute clock time at which the user must leave home. The Tier 2 anchor.
- **Appears as:** UI label `BY hh:mm` (e.g. `BY 07:08`), code symbol `leave_by_time`.
- **Relation:** `leave_by_time = arrival_time − time_to_stop_mins`. The comfort buffer is *not* part of Leave By — it only sizes the **window** for the marker.

### Arrives In
Minutes until the catchable service arrives at the stop. Tier 2 detail, paired with **arrival time**.
- **Appears as:** UI label `ARRIVES IN n MIN`, code symbol `arrives_in_mins`.
- **Not to be confused with:** **Leave In** (when *you* must leave home).

### Arrival time
The absolute clock time at which the service arrives at the stop. Tier 2 detail.
- **Appears as:** UI label `· hh:mm` (paired with **Arrives In**, e.g. `ARRIVES IN 4 MIN · 07:14`), code symbol `arrival_time`.

### Now
The hero state when **Leave In** reaches zero. The hero value renders the literal string `NOW` under the unchanged `LEAVE IN` label. No column inversion, no separate banner.
- **Appears as:** the literal hero value `NOW`.
- **Not to be confused with:** ~~LEAVE NOW banner~~ (legacy, deprecated), ~~urgency state~~, ~~urgency filter~~ (legacy, deprecated).

### Next services
The fallback services shown in Tier 3 — up to **three** departures *after* the **catchable service** (the Tier 1 hero), so the rider sees their later options if the hero falls through or they simply miss it. The first of these is the service **promoted** into the catchable slot when the hero becomes a **missed service**.
- **Appears as:** UI label `NEXT hh:mm → hh:mm → hh:mm` (chained with a ` → ` separator), shrinking to fewer times — or a single `NEXT hh:mm` — when fewer follow the hero; code symbol `next` (one composed string). Renders `—` when no service follows the hero.
- **Not to be confused with:** ~~backup service~~, ~~secondary service~~, ~~next service~~ (singular — superseded once Tier 3 showed more than one) — all deprecated.

### Wall-clock time
The current local time, rendered in the **global header**.

---

## 4. Service states

### Catchable service
A scheduled service the user can still make given their **time to stop** and current wall-clock time. Drives Tier 1, Tier 2, and the marker position.

### Missed service
A service whose **Leave In** has reached zero and elapsed unmade. It is removed from the column; the **next service** is **promoted** into its slot.

### Cancelled service
A service the operator has cancelled. Rendered with strike-through directly above the **replacement service** in the same column. No `CANCELLED` text label — the strike-through is the signal.
- **Not to be confused with:** ~~dead service~~ (deprecated), **missed service** (the user didn't leave in time — different cause).

### Replacement service
The next scheduled service that takes over Tier 1 after a **cancelled service** in the same column.
- **Not to be confused with:** **next service** (Tier 3 — the *fallback after* the replacement).

### Delayed service
A service running later than scheduled. Rendered with a bordered `DELAYED +n MIN` banner above Tier 2. A delay is **good news** — it grows **Leave In** and slides the marker leftward (recovered **leave margin**). Never an error state.

### No-service state
The state when zero **catchable services** exist within the next 60 minutes. The Tier 1 hero is replaced by the literal `NO SERVICE`, with the next available departure clock time below it.

### Promotion
The act of moving the **next service** into the catchable slot when the **catchable service** becomes a **missed service**. The next-service slot then renders `—` until the next wake cycle fetches a fresh next service.

---

## 5. The marker widget

### Track
The horizontal line in each column representing a **window** of fixed duration. The **marker** travels along it.
- **Not to be confused with:** ~~progress bar~~, ~~walk-window progress bar~~, ~~progress widget~~ — all deprecated.

### Marker
The diamond glyph that travels left→right along the track as time passes. Hard-right = **Now**.
- **Invariants:** moves in one direction only (right); never animates between frames — it **jumps** position each wake cycle.
- **Not to be confused with:** ~~fill bar~~, ~~progress fill~~, ~~indicator bar~~, ~~diamond~~ (bare — say "marker") — all deprecated.

### Window
The fixed time span represented by the full length of the track. Window length is constant within a profile phase, so the marker's apparent speed is constant — the user learns the rate.

---

## 6. Margins, buffers, distances

### Time to stop
The minutes it takes the user to travel from home to the stop, regardless of mode — walking, driving, scootering, all count.
- **Appears as:** config key `time_to_stop_mins:`, code symbol `time_to_stop_mins`.
- **Not to be confused with:** ~~walk_time_mins~~ (deprecated — misleading when the leg is driven), ~~walk time~~ (same).

### Comfort buffer
The multiplier on **time to stop** that defines the left edge of the **window**. With time to stop = 7 min and comfort buffer = 3, the marker enters the track from hard-left when **leave margin** = 21 min (i.e. the user has 28 min until departure: 7 min to stop + 21 min buffer).
- **Appears as:** config key `comfort_buffer:`, code symbol `comfort_buffer`.
- **Not to be confused with:** ~~comfortable_buffer_factor~~ (legacy key, deprecated).

### Leave margin
The slack between *now* and **Leave By**. Drives the **marker** position on the track. Clamped to ≥ 0; when it reaches 0, the hero enters **Now**.
- **Appears as:** code symbol `leave_margin`.
- **Not to be confused with:** ~~safety margin~~ (legacy, deprecated).

---

## 7. Profiles & modes

### Profile
A named user/household configuration. One profile may be shared by multiple radiators.
- **Appears as:** config keys under `profiles:`, e.g. `philip_and_tania`, `daughter_school`.
- **Not to be confused with:** **user** (a person — multiple people can share one profile).

### Idle profile
A system-wide default profile that takes over when server time falls outside every configured **profile phase** of the slug's profile (e.g. overnight gaps between configured phases). Renders a low-frequency ambient layout with a long **sleep duration** (capped at 4 h). The Worker never errors on "no active phase" — it falls through to the idle profile and returns `200`.
- **Appears as:** the literal `X-Profile-Phase: idle_profile` response header, prose ("the idle profile takes over overnight").
- **Defined by:** [ADR-0003](adr/0003-radiator-worker-contract.md) §"Idle profile". Layout and content source are a deferred follow-up.

### Profile phase
A named time-of-day phase inside a profile. Each phase has a `start_time`, an `end_time`, a **layout**, and (for `priority_split`) one or more **transit targets**.
- **Appears as:** config keys e.g. `morning_commute`, `workday_focus`, `morning_school_run`, `afternoon_idle`, `evening_return`.
- **Not to be confused with:** ~~state~~ (overloaded with state-machine talk), ~~mode~~ (overloaded with transport mode — see **mode**).

### Transit target
One configured stop or station that the radiator watches inside a profile phase. A profile phase using `priority_split` has one or two transit targets.
- **Appears as:** config keys under `transit_targets:`, code symbol `transit_target`.
- **Not to be confused with:** ~~target~~ (bare — always qualify), ~~feed~~, ~~stream~~.

### Mode
The transport mode of a transit target. Two values: **bus** and **train**.
- **Appears as:** config keys `bus:`, `train:` under `transit_targets:`, and the **mode icon** in the column header.
- **Not to be confused with:** **profile phase** (a time-of-day phase — different axis).

---

## 8. Radiator ↔ Worker contract

The wire contract — paths, headers, status codes, response shapes — is specified in [`docs/api/openapi.yaml`](api/openapi.yaml). The rationale behind every choice (why `GET /v1/frame`, why missing-vs-invalid token are indistinguishable, why the `X-Radiator-*` namespace, …) is in [ADR-0003](adr/0003-radiator-worker-contract.md). This section names the concepts that appear in both.

### Radiator slug
The radiator's unique short identifier (e.g. `bedroom-philip-tania`). Hardcoded as a compile-time constant in firmware.
- **Format:** `^[a-z0-9-]{3,64}$`.
- **Appears as:** config keys under `radiators:`, HTTP request header `X-Radiator-Slug`.
- **Not to be confused with:** **hardware id** (a separate physical-board identifier), ~~device slug~~, ~~user slug~~, ~~X-Device-User~~ — all deprecated.

### Shared token
The static secret token every radiator sends to authenticate with the Worker.
- **Appears as:** HTTP request header `X-Radiator-Token`, Worker secret `RADIATOR_SHARED_TOKEN`.
- **Not to be confused with:** ~~X-Device-Token~~, ~~DEVICE_SHARED_TOKEN~~ — legacy.

### Hardware id
Stable per-board identifier (typically the ESP32-S3 MAC address) — survives **radiator slug** reassignment, so it can track which physical board carries which slug across re-flashes.
- **Appears as:** HTTP request header `X-Radiator-Hardware-Id` (optional).
- **Not to be confused with:** **radiator slug** (the logical identifier, hardcoded at flash time).

### Sleep duration
The number of seconds the radiator should deep-sleep before its next **wake cycle**. Set by the Worker on every response (including errors). Allowed range `30 ≤ n ≤ 14400`.
- **Appears as:** HTTP response header `X-Sleep-Seconds`, code symbol `sleep_seconds`.

### Wake cycle
One iteration of: panel wakes → radiator fetches frame from Worker → panel flushes new frame → radiator deep-sleeps for **sleep duration**.

### KV cache
The Cloudflare KV store of recent Metlink GTFS-Realtime responses. 30-second TTL. Bypassed entirely for the `minimal_clock` and `idle_profile` layouts.

### `X-Radiator-*` request-header namespace
Reserved prefix for any future radiator-side telemetry header (e.g. `X-Radiator-Battery-Pct`, `X-Radiator-Firmware-Version`, `X-Radiator-Wifi-Rssi`). The Worker MUST ignore unknown headers in this namespace so firmware can add telemetry without a Worker change.

### Worker informational response headers
Diagnostic headers the Worker sets on every meaningful response. The radiator's firmware ignores them; they exist for humans running `curl` and for future polling tools. Adding new ones is free — no contract bump, no firmware change.

| Header | Meaning |
|---|---|
| `X-Server-Time` | Worker clock at request time (ISO 8601 UTC). |
| `X-Profile-Phase` | Resolved profile phase key, or `idle_profile` for the fallback. |
| `X-Metlink-Fetched-At` | When the cached Metlink data was originally fetched (ISO 8601 UTC). |
| `X-Cache-Status` | `hit` / `miss` / `stale-served`. |

### Diagnostics view
The diagnostics surface the Worker returns from `/v1/frame` instead of the rendered BMP, selected by the request's `Accept` header (ADR-0004). Two variants: `Accept: application/json` returns the JSON **view model**; `Accept: image/svg+xml` returns the intermediate Satori SVG — the exact document the BMP encoder rasterises for this render, gzipped per ADR-0001 so a human can open it in a browser. Same auth, slug resolution, sleep duration, and informational headers as the BMP path — only the body and `Content-Type` differ. The radiator never negotiates either; it is a surface for humans and tests running `curl`.
- **`?include_bmp`** — a query param on the JSON diagnostics view only. `?include_bmp=1` adds a `frame_bmp_base64` field decoding to the exact BMP an `Accept: image/bmp` sibling call would have returned at the same instant. Default off, so the common diagnostics response stays small.

---

## 9. Rendering pipeline (terms held verbatim from libraries / standards)

### View model
The structured input the renderer (Satori) receives for a given render: the active **profile phase**, the **layout**, and the per-column **transit target** data. The **diagnostics view** serialises it verbatim — one source of truth, rasterised to BMP for the radiator, exposed as the intermediate Satori SVG, or serialised to JSON for diagnostics (ADR-0004).

The remaining terms below come from third-party libraries or industry standards. Used as-is, not redefined.

- **Satori** — the SVG layout engine used inside the Worker.
- **GTFS-Realtime** — the Metlink API standard.
- **BMP** — the 1-bit bitmap format flushed to the panel.
- **DejaVu Sans Bold** — the display typeface used for all text (see [ADR-0009](adr/0009-display-typeface-dejavu-sans-bold.md)). Replaced Press Start 2P, whose monospace metric caused recurring fit problems. The custom 8-bit **mode icons** are kept as a deliberate mix — pixel icons (symbols) beside smooth text (data).
- **EPD** — Electronic Paper Display (the panel hardware standard).
- **deep sleep** — the ESP32-S3 power state during the gap between wake cycles.

---

## 10. Deprecated terms — do not use

Each row is a violation of the language. If you find one in the PRD, UI doc, config, or code, fix it.

| Don't say | Say instead |
|---|---|
| Home Transit Radiator | GottaGo (product) / radiator (unit) |
| device, client, client device | radiator |
| e-ink display | panel |
| backup service | next service |
| dead service | cancelled service |
| route code | service name (column-header label = `service_id · trip_headsign`) — the parts are service id + trip headsign; the legacy "route code" conflated them |
| progress bar, walk-window progress bar, fill bar, progress widget | track + marker |
| diamond (bare) | marker |
| safety margin | leave margin |
| LEAVE NOW banner, urgency state, urgency filter | Now (the literal hero value under the `LEAVE IN` label) |
| comfortable_buffer_factor | comfort buffer |
| walk_time_mins, walk time | time_to_stop_mins, time to stop |
| state (for `morning_commute` etc.) | profile phase |
| target (bare) | transit target |
| X-Device-User, X-Device-Token | X-Radiator-Slug, X-Radiator-Token |
| DEVICE_SHARED_TOKEN | RADIATOR_SHARED_TOKEN |
| devices: (config block) | radiators: |
| 4 MIN (unlabelled hero) | label every number — hero is `LEAVE IN` followed by the value |

---

## 11. Open questions (language work still pending)

1. **Naming of the strike-through above a cancelled service.** Currently unnamed — we have "cancelled service" (the rendered struck line) and "replacement service" (Tier 1 below it). Probably fine without a third name, but flag if it surfaces in conversation.
2. **`refresh_interval_minutes` vs `sleep duration`.** These describe the same thing from different sides — config-side cadence vs response-side instruction. Probably acceptable as two names for two angles; revisit if they ever drift.
