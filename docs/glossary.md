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
The structural template a frame uses. Four layouts exist:
- `priority_split` — global header + one or two columns of transit content.
- `minimal_clock` — full-screen wall-clock time.
- `idle_jokes` — the **idle profile**'s ambient content: a dad joke beside a meme, no wall-clock. Rendered overnight when no **profile phase** is active.
- `dual_month_calendar` — current-date header above two Monday-start month grids: this month (left) and next month (right), today's cell inverted. Pure date math, no external data; its content changes at most once a day, so it pairs with the **unchanged-frame skip**.
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

### Per-row service-id prefix
When a **transit target**'s **service id** is an any-of array, successive departures under one **column header** may be different routes. Each rendered row (**NEXT**, **THEN**, **LATER**, **LAST**) is then prefixed with its own service id so the mixed routes stay distinguishable (e.g. `635 · 31 MIN · 08:06`). A single-route target needs no prefix — the column header already names its one route — so its rows render bare.
- **Appears as:** the leading service id on a row's value line; wire field `route_prefix` on each slot (empty string for a single-route target), code symbol `routePrefix`.

### Destination stop id
An optional second filter on a **transit target**: the upstream Metlink `destination.stop_id` of the terminus a departure runs to. When a single route branches to several termini at a shared stop, the **service id** filter alone passes all branches; setting a destination stop id narrows the target to the wanted terminus (e.g. Churton Park `3281` at stop 5012). Accepts a single id or an any-of array, mirroring **service id**; absent means no destination filter. Internal to the gateway — not shown to the user.
- **Appears as:** config key `destinationStopId` under a transit target, wire field `destination.stop_id`, code symbol `destinationStopId`.
- **Not to be confused with:** **trip headsign** (the human-readable destination *label* shown in the header; the destination stop id is a stable identifier used only for filtering).

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

### Early service
A service running ahead of schedule (negative delay). The signed twin of a **delayed service**: rendered with a bordered `EARLY −n MIN` badge on whichever slot the departure occupies. Where a delay is good news, an early run is **bad news** — it *shrinks* **Leave In** (leave sooner). The badge shows only when the deviation rounds to 1 minute or more early; an on-time service (rounds to 0) carries no badge.

### No-service state
The state when zero **catchable services** exist within the next 120 minutes. The Tier 1 hero is replaced by the literal `NO SERVICE`, with the next available departure clock time below it.

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

### RUN limit
The largest lateness, in minutes, at which a **just-missed service** on the LAST row is still sprintable — tagged `RUN` rather than `MISSED`. A just-missed service is one whose **Leave By** has already passed but which has not yet reached the stop, so it lingers one more frame in the live feed; the LAST row echoes it with a *negative* **Leave In** until it arrives and drops out. At or below the RUN limit the rider can plausibly still make it (tag `RUN`); above it, the service is shown `MISSED`. Set per **profile phase**; absent → the domain default of **1 minute**. Only `priority_split_v2` honours it — the old `priority_split` (v1) ignores it.
- **Appears as:** config key `runLimitMins:`, code symbol `runLimitMins`; UI tags `RUN` / `MISSED` on the LAST row.

---

## 7. Profiles & modes

### Profile
A named user/household configuration. One profile may be shared by multiple radiators.
- **Appears as:** config keys under `profiles:`, e.g. `philip_and_tania`, `daughter_school`, `philip_office`.
- **Not to be confused with:** **user** (a person — multiple people can share one profile).

### Idle profile
A system-wide default profile that takes over when server time falls outside every configured **profile phase** of the slug's profile (e.g. overnight gaps between configured phases). Renders the `idle_jokes` **layout** with a long **sleep duration** (until the next phase opens, capped at 4 h). The Worker never errors on "no active phase" — it falls through to the idle profile and returns `200`. A profile may carry its own `idle` override; absent that, the system default applies.
- **Appears as:** the literal `X-Profile-Phase: idle_profile` response header, prose ("the idle profile takes over overnight").
- **Defined by:** [ADR-0003](adr/0003-radiator-worker-contract.md) §"Idle profile"; layout and content source settled in #17 (`idle_jokes`, dad jokes from icanhazdadjoke).

### Profile phase
A named time-of-day phase inside a profile. Each phase has a `start_time`, an `end_time`, a **layout**, optional **active days**, and (for `priority_split`) one or more **transit targets**.
- **Appears as:** config keys e.g. `morning_commute`, `workday_focus`, `morning_school_run`, `daytime_calendar`, `evening_return`.
- **Not to be confused with:** ~~state~~ (overloaded with state-machine talk), ~~mode~~ (overloaded with transport mode — see **mode**).

### Active days
The set of weekdays a **profile phase** is eligible to run, as lowercase three-letter tokens (`mon`–`sun`). Absent means **every day** — the common case. A phase is active only when its `[start_time, end_time)` window contains the local (**Pacific/Auckland**) time *and* its active days include today's local weekday; otherwise the resolver skips it, falling through to the next eligible phase or the **idle profile**. Used to keep weekday commute and school-run phases from firing — and burning battery / Metlink calls — on weekends. The filter applies to the active-phase match only: the next-phase **sleep duration** scan stays day-agnostic and leans on the 4 h cap rather than scanning across days ([ADR-0015](adr/0015-profile-phase-active-days.md)).
- **Appears as:** config key `days:` under a profile phase, code symbol `days`, type `Weekday`.
- **Not to be confused with:** the phase's `start_time` / `end_time` (time-of-day, orthogonal to day-of-week), ~~schedule~~ (the whole time model).
- **Defined by:** [ADR-0015](adr/0015-profile-phase-active-days.md); implemented in #92 (parent #87).

### `daytime_calendar`
The bedroom radiator's daytime **profile phase**: it runs the `dual_month_calendar` **layout** between the morning and afternoon commute windows. Replaces the radiator's earlier all-day clock phase. (Written for the office radiator before that device existed; the office's full-day calendar now lives in `morning_calendar` / `evening_calendar`.)
- **Appears as:** config key `daytime_calendar`, `X-Profile-Phase: daytime_calendar`.
- **Not to be confused with:** `dual_month_calendar` (the **layout** the phase runs — content vs schedule), `morning_calendar` / `evening_calendar` (the office radiator's calendar phases), ~~all_day_clock~~ (the predecessor phase, deprecated).

### `morning_calendar` / `evening_calendar`
The office radiator's calendar **profile phases**: they run the `dual_month_calendar` **layout** before (00:00–15:00) and after (19:30–24:00) the office afternoon commute window, at the 4 h **sleep duration** cap. On weekdays they bracket `office_afternoon_commute` to cover the full day, so the **idle profile** never engages; on weekends the commute is out of its **active days** (mon–fri), so its 15:00–19:30 slot falls through to the idle profile. With the **unchanged-frame skip**, the only visible panel flash is the daily date rollover. Two keys rather than one reused key because phase keys are globally unique (the `test-<phaseKey>` scenario slugs resolve a phase by bare key) — which is also why the office commute phase is `office_afternoon_commute`, not a second `afternoon_commute`.
- **Appears as:** config keys `morning_calendar` / `evening_calendar`, `X-Profile-Phase: morning_calendar` / `evening_calendar`.
- **Not to be confused with:** `daytime_calendar` (the bedroom's daytime window), `dual_month_calendar` (the **layout** all three calendar phases run).

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
- **Appears as:** HTTP request header `Authorization: Bearer <token>` (Cloudflare auto-redacts it to `********` in Workers Logs — GH #121), Worker secret `RADIATOR_SHARED_TOKEN`.
- **Not to be confused with:** ~~X-Device-Token~~, ~~DEVICE_SHARED_TOKEN~~ — legacy. `X-Radiator-Token` is the deprecated transport: the Worker still accepts it during rollout, but it is captured in Workers Logs in cleartext, so radiators must send `Authorization` instead.

### Hardware id
Stable per-board identifier (typically the ESP32-S3 MAC address) — survives **radiator slug** reassignment, so it can track which physical board carries which slug across re-flashes.
- **Appears as:** HTTP request header `X-Radiator-Hardware-Id` (optional).
- **Not to be confused with:** **radiator slug** (the logical identifier, hardcoded at flash time).

### Battery level
The radiator's raw battery voltage in **millivolts**, sampled once per **wake cycle** (before Wi-Fi starts — the ADC and the radio share hardware) and sent to the Worker, which logs it as telemetry. Deliberately raw and uninterpreted: the discharge curve, any percentage mapping, and charging detection are server-side concerns, deferred to the fast follow (GH #80).
- **Appears as:** HTTP request header `X-Radiator-Battery-Mv` (optional; omitted on a failed read), log field `batteryMv`, code symbol `readBatteryMv`.
- **Not to be confused with:** a battery *percentage* (no discharge curve exists yet — the PoC's linear 3.30 V → 4.20 V map was display-only, not a contract).

### Sleep duration
The number of seconds the radiator should deep-sleep before its next **wake cycle**. Set by the Worker on every response (including errors). Inside an active **profile phase** it is the phase's `refresh_interval_minutes` truncated at the next phase boundary (the earliest other phase start, or the active phase's own end), so a long-interval phase never oversleeps the next phase or the **idle profile** handoff. Allowed range `30 ≤ n ≤ 14400`.
- **Appears as:** HTTP response header `X-Sleep-Seconds`, code symbol `sleep_seconds`.

### Wake cycle
One iteration of: panel wakes → radiator fetches frame from Worker → panel flushes new frame (skipped on an **unchanged-frame skip**) → radiator deep-sleeps for **sleep duration**.

### Conditional frame request
A frame request carrying `If-None-Match` with the radiator's stored **ETag**. When the Worker's freshly derived ETag matches, the response is `304 Not Modified` — no body, no render — with `X-Sleep-Seconds` still set, and the firmware performs an **unchanged-frame skip**. Only the `image/bmp` path participates; the JSON/SVG **diagnostics view** variants always return `200`, and error paths return their **problem document** regardless.
- **Appears as:** HTTP request header `If-None-Match`, response status `304`.
- **Defined by:** [ADR-0013](adr/0013-conditional-frame-requests.md).

### ETag
The weak validator (`W/"…"`) identifying a frame's *content inputs*: a hash of the layout's serialised **view model** plus its `LAYOUT_VERSION` constant — never the rendered bytes, so a `304` is answered without running the render pipeline. Opaque to the radiator, which stores it only after a successfully flushed `200`, echoes it as `If-None-Match` on the next **wake cycle**, and clears it after rendering the error screen.
- **Appears as:** HTTP response header `ETag`, HTTP request header `If-None-Match`, code constant `LAYOUT_VERSION`.
- **Not to be confused with:** a frame *checksum* (the ETag hashes the inputs that drive pixels, not the BMP bytes).

### Unchanged-frame skip
The firmware behaviour on a `304 Not Modified`: parse `X-Sleep-Seconds`, do **not** touch the panel (it already shows this frame — no flush, no eye-pull), keep the stored **ETag**, deep-sleep. The third firmware decision beside flush (`200`) and error screen (non-2xx).
- **Appears as:** prose ("the daytime wakes answer 304 and skip"), [ADR-0013](adr/0013-conditional-frame-requests.md)'s `304` row in the ADR-0003 firmware-behaviour table.
- **Not to be confused with:** the old ~~hold the last frame on any non-2xx~~ rule (an *error* behaviour, superseded by ADR-0011 — the skip is a *success* behaviour: the content is confirmed current).

### `X-Radiator-*` request-header namespace
Reserved prefix for radiator-side telemetry headers. Realized: `X-Radiator-Hardware-Id` (**hardware id**), `X-Radiator-Battery-Mv` (**battery level**); future candidates: `X-Radiator-Firmware-Version`, `X-Radiator-Wifi-Rssi`. The Worker MUST ignore unknown headers in this namespace so firmware can add telemetry without a Worker change.

### Worker informational response headers
Diagnostic headers the Worker sets on every meaningful response. The radiator's firmware ignores them; they exist for humans running `curl` and for future polling tools. Adding new ones is free — no contract bump, no firmware change.

| Header | Meaning |
|---|---|
| `X-Server-Time` | Worker clock at request time (ISO 8601 UTC). |
| `X-Profile-Phase` | Resolved profile phase key, or `idle_profile` for the fallback. |

### Problem document
The `application/problem+json` body returned on **every** error response ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)), regardless of the negotiated success format. Members: `type` (the **problem type** URL), `title` (the firmware error-screen heading), `status`, `detail` (per-occurrence prose), an optional `instance` (`urn:gotta-go:request:<requestId>`, omitted when no `X-Request-Id`), and the `upstream_detail` extension. The firmware renders one generic error screen from it (replacing the old "hold the last frame on non-2xx" rule).
- **Appears as:** the error response body; `Content-Type: application/problem+json`.
- **Defined by:** [ADR-0011](adr/0011-error-contract-problem-details.md); catalogued in [`api/errors.md`](api/errors.md).
- **Not to be confused with:** ~~plain-text error body~~ (deprecated — was one lowercase string the radiator ignored, superseded by ADR-0011).

### Problem type
A named, catalogued failure (`metlink-auth`, `metlink-unavailable`, `unauthorized`, `unknown-radiator`, `internal`, …) identified by a stable `type` URL that dereferences to its anchor in [`api/errors.md`](api/errors.md). Two orthogonal axes classify each: **`status`** (whose fault — `500` ours / `502` upstream's) and **class** (**Fatal / Retryable**).
- **Appears as:** the `type` member of a **problem document**; one `## <slug>` section per type in `api/errors.md`.

### Fatal / Retryable
The self-heal axis of a **problem type**. **Fatal** — a human must act; the Worker backs off hard (`X-Sleep-Seconds: 3600`) and logs at `error` (config errors) or `warn` (auth/slug). **Retryable** — transient; the next **wake cycle** may succeed, so the Worker sleeps at the active **profile phase**'s **sleep duration** and logs at `warn` (or `error` for `internal`).
- **Appears as:** prose, `api/errors.md` per-type entries, [ADR-0011](adr/0011-error-contract-problem-details.md).
- **Not to be confused with:** **mode** / **profile phase** (unrelated axes).

### `upstream_detail`
The extension member of a **problem document** carrying the raw upstream snippet (e.g. Metlink's error body), capped at **2 KB** — the same cap the structured logs use. Present only on problem types with an upstream cause (`metlink-*`). The firmware renders it **only under its `verbose` flag**; other clients ignore unknown extension members.
- **Appears as:** the `upstream_detail` member; firmware `verbose` flag in `setting.h`.

### Diagnostics view
The diagnostics surface the Worker returns from `/v1/frame` instead of the rendered BMP, selected by the request's `Accept` header (ADR-0004). Two variants: `Accept: application/json` returns the JSON **view model**; `Accept: image/svg+xml` returns the intermediate Satori SVG — the exact document the BMP encoder rasterises for this render, gzipped per ADR-0001 so a human can open it in a browser. Same auth, slug resolution, sleep duration, and informational headers as the BMP path — only the body and `Content-Type` differ. The radiator never negotiates either; it is a surface for humans and tests running `curl`.
- **`?include_bmp`** — a query param on the JSON diagnostics view only. `?include_bmp=1` adds a `frame_bmp_base64` field decoding to the exact BMP an `Accept: image/bmp` sibling call would have returned at the same instant. Default off, so the common diagnostics response stays small.

---

## 9. Rendering pipeline (terms held verbatim from libraries / standards)

### View model
The structured input the renderer (Satori) receives for a given render: the active **profile phase**, the **layout**, and the per-column **transit target** data. The **diagnostics view** serialises it verbatim — one source of truth, rasterised to BMP for the radiator, exposed as the intermediate Satori SVG, or serialised to JSON for diagnostics (ADR-0004).

The remaining terms below come from third-party libraries or industry standards. Used as-is, not redefined.

- **Satori** — the SVG layout engine used inside the Worker.
- **Stop Predictions** — Metlink's REST departure-prediction endpoint (`GET /stop-predictions?stop_id=<id>`), polled once per **wake cycle** for `priority_split` frames. The data source GottaGo uses — **not** GTFS-Realtime (a separate Metlink standard GottaGo does not consume for predictions).
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
| plain-text error body (one lowercase string, radiator-ignored) | problem document (`application/problem+json`, RFC 9457 — ADR-0011) |
| all_day_clock | daytime_calendar (the phase) / dual_month_calendar (the layout it runs) — the clock-era phase is gone |
| cadence (phase cadence, wake cadence, retry cadence, sleep cadence) | sleep duration (the per-response sleep value a phase sets) / wake cycle (one wake→fetch→flush→sleep iteration) — "cadence" is not a domain term |

---

## 11. Open questions (language work still pending)

1. **Naming of the strike-through above a cancelled service.** Currently unnamed — we have "cancelled service" (the rendered struck line) and "replacement service" (Tier 1 below it). Probably fine without a third name, but flag if it surfaces in conversation.
2. **`refresh_interval_minutes` vs `sleep duration`.** Config-side interval vs response-side instruction. They have now drifted by design: the sleep duration is the refresh interval truncated at the next phase boundary (see **Sleep duration**), so the two names earn their keep.
