# ADR-0002: Metlink `/stop-predictions` field mapping and API contract

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.

## Context

Before implementing the Worker's Metlink integration, a live spike was needed to confirm:

1. Which endpoint to call for bus **stop** predictions and train **station** predictions.
2. The exact JSON field paths for: scheduled arrival, realtime predicted arrival, route code, cancellation flag, delay magnitude.
3. Whether cancellation and delay states are surfaced in the same endpoint or require a separate call.
4. API authentication method, rate-limit behaviour, and observed latency ranges.
5. How the API's `cache-control` policy interacts with the 30-second **KV cache** TTL.

Live calls were made on 2026-05-23 against the Metlink Wellington Open Data API (`https://api.opendata.metlink.org.nz/v1`) using two real-world **transit targets** from the household:

| Transit target | Stop | Mode |
|---|---|---|
| Morning commute — train | `TAKA1` (Takapu Rd Station, KPL line) | train |
| Morning commute — bus | `3234` (Westchester Dr, route 1 to Island Bay) | bus |

The Swagger definition lives at [`../../docs/metlink-api-swagger.json`](../../docs/metlink-api-swagger.json).

---

## Decision

**The Worker uses a single endpoint — `GET /stop-predictions?stop_id=<id>` — for both bus and train transit targets.** There is no separate train endpoint; `stop_id` covers all modes. The response is identical in structure regardless of mode.

**The Worker filters departures by `service_id` client-side.** The `service_id` query parameter is listed in some clients (including the Bruno collection) but is silently ignored by the API — it returns all routes through the stop regardless. Filtering must be applied in the Worker after fetch.

---

## API contract

### Authentication

- **Header:** `x-api-key: <key>`
- **Placement:** request header (not query parameter)
- **Rate limits:** 10 requests/second sustained, burst of 20. No rate-limit headers appear in responses — limits are documented only, not machine-readable.

### Endpoint

```
GET https://api.opendata.metlink.org.nz/v1/stop-predictions?stop_id=<stop_id>&limit=<n>
```

- `stop_id` — required. Accepts both numeric bus stop codes (e.g. `3234`) and alphanumeric train station codes (e.g. `TAKA1`).
- `limit` — optional. Omitting it returns the full day's departures (~25–50 entries). The Worker should request only what it needs (e.g. `limit=5`) to reduce payload size.
- `service_id` — **NOT a real filter.** Silently ignored; omit it.

### Response envelope

```json
{
  "farezone": "4",
  "closed": false,
  "departures": [ ... ]
}
```

`closed` would be `true` if the stop is temporarily closed; the Worker should treat a `closed: true` response as a **no-service state**.

---

## Field mapping table

All fields live at `departures[n].<field>`.

| GottaGo concept | Field path | Type | Notes |
|---|---|---|---|
| **Route code** | `service_id` | string | e.g. `"KPL"`, `"1"`. Use as the column header route code. |
| **Scheduled arrival** | `arrival.aimed` | ISO 8601 string | Always present. e.g. `"2026-05-23T06:48:00+12:00"`. |
| **Predicted arrival** | `arrival.expected` | ISO 8601 string or null | `null` when `monitored: false` (live tracking not yet active). Use `arrival.aimed` as fallback. |
| **Delay magnitude** | `delay` | ISO 8601 duration string | Always present (never null). `"PT0S"` = on time. `"PT6M12S"` = 6 min 12 sec late. Parse to seconds and round to nearest minute for the `DELAYED +n MIN` banner. |
| **Service state** | `status` | string or null | `null` = normal/scheduled. `"delayed"` = delayed service. `"cancelled"` = cancelled service (not observed in this spike; inferred from GTFS-RT standard and the `/trip-cancellations` endpoint structure). |
| **Live tracking active** | `monitored` | boolean | `true` = vehicle is tracked; `expected` is populated. `false` = scheduled only; `expected` is null. |
| **Trip identity** | `trip_id` | string | Used to cross-reference with `/trip-cancellations` if needed. |

### `arrival` vs `departure`

At **mid-route stops** (e.g. `TAKA1`, `3234`), `arrival.aimed` and `departure.aimed` are identical — Metlink does not model dwell time. Use `arrival.aimed` / `arrival.expected` as the primary fields.

At **origin stops** (the first stop of a route), `arrival` only contains `{expected: null}` — the `aimed` key is absent entirely. `departure.aimed` is the only source of the scheduled time. Verified live against stop `6001` (Wellington Station Stop C), which is the origin for route 17 outbound.

**Worker extraction rule:**

```
scheduled_time = arrival.aimed ?? departure.aimed   // null-coalesce
realtime_time  = arrival.expected ?? departure.expected ?? scheduled_time
```

This handles mid-route, origin, and the `monitored: false` fallback in a single expression. The GottaGo household's transit targets (`TAKA1`, `3234`) are both mid-route stops, so this edge case does not affect the morning commute — but it will matter if an origin stop is ever added to a profile.

---

## Sample payloads

### Delayed train departure (`status: "delayed"`, `monitored: true`)

```json
{
  "stop_id": "TAKA1",
  "service_id": "KPL",
  "direction": "inbound",
  "operator": "RAIL",
  "origin": { "stop_id": "WAIK", "name": "WaikanaeStn" },
  "destination": { "stop_id": "WELL1", "name": "WELL-All stops" },
  "delay": "PT6M12S",
  "vehicle_id": "4278",
  "name": "TakapuRdStn",
  "arrival": {
    "aimed": "2026-05-23T05:48:00+12:00",
    "expected": "2026-05-23T05:54:12+12:00"
  },
  "departure": {
    "aimed": "2026-05-23T05:48:00+12:00",
    "expected": "2026-05-23T05:54:12+12:00"
  },
  "status": "delayed",
  "monitored": true,
  "wheelchair_accessible": true,
  "trip_id": "KPL__1__6407__RAIL__Rail_Sa_20260419",
  "trip_headsign": "Wellington Station"
}
```

**Worker behaviour:** `status == "delayed"` → render `DELAYED +6 MIN` banner (round `PT6M12S` to nearest minute). Use `arrival.expected` for **arrival time** and recompute **Leave In** and **Leave By** against `arrival.expected`.

### Scheduled-only train departure (`status: null`, `monitored: false`)

```json
{
  "stop_id": "TAKA1",
  "service_id": "KPL",
  "delay": "PT0S",
  "vehicle_id": null,
  "arrival": {
    "aimed": "2026-05-23T06:48:00+12:00",
    "expected": null
  },
  "status": null,
  "monitored": false
}
```

**Worker behaviour:** `status == null` + `monitored == false` → normal display. Use `arrival.aimed` as arrival time (no live data yet).

### Bus departure (service_id=1, `status: null`, `monitored: false`)

```json
{
  "stop_id": "3234",
  "service_id": "1",
  "direction": "inbound",
  "operator": "TZM",
  "origin": { "stop_id": "3280", "name": "Churton Prk-Melksha" },
  "destination": { "stop_id": "6158", "name": "Island Bay" },
  "delay": "PT0S",
  "vehicle_id": null,
  "arrival": {
    "aimed": "2026-05-23T06:51:00+12:00",
    "expected": null
  },
  "status": null,
  "monitored": false
}
```

**Worker note:** Stop `3234` serves routes `1` (Island Bay), `19` (Johnsonville), and `N5` (night service) in a single response. Client-side filter on `service_id` is required.

---

## Cancellation handling

### Verification status

A deliberate follow-up investigation was run to verify how cancelled trips appear in `/stop-predictions`. The investigation checked:

1. **`/trip-cancellations`** for upcoming cancellations — returned 0 future-dated trips (all 146 recent cancellations were for completed trips).
2. **`/gtfs-rt/tripupdates`** for live GTFS-RT cancelled entities — 14 entities, all `schedule_relationship: 0` (SCHEDULED), none cancelled.
3. **`/gtfs-rt/servicealerts`** — 31 alerts, none carrying trip cancellations.

**Result:** No live cancellations were available to observe at time of investigation (early Saturday morning). The question of whether cancelled trips appear in `/stop-predictions` as `status: "cancelled"` or are silently dropped could not be confirmed from a live sample.

### Two possible behaviours (design implications)

| Behaviour | What the Worker sees | Design consequence |
|---|---|---|
| **A — trip retained** (`status: "cancelled"`) | Entry present with `status == "cancelled"` | Worker can detect the cancellation and render the struck-through display per PRD §5.1 |
| **B — trip removed** (silently absent) | Entry disappears; next service becomes the first entry | Worker cannot distinguish a cancelled trip from a departed one; the cancelled-service screen is never rendered |

Behaviour A is the expected outcome because: (a) the API already uses the `status` field to surface `"delayed"`, and Metlink's GTFS-RT spec uses `ScheduleRelationship.CANCELED`; (b) silently dropping a trip provides no actionable signal to a passenger. The Worker is implemented assuming Behaviour A, but **this must be confirmed before the cancelled-service rendering path ships** (see follow-up below).

### Reproduction methodology

Route 17 had 5+ consecutive cancellations on Friday night (2026-05-22), all `service_id: "17"`, `operator: "TZM"`. When the next route-17 cancellation is announced:

1. Call `/trip-cancellations?date_updated=<today>` to find the `trip_id`.
2. Call `/gtfs/stop_times?trip_id=<trip_id>` to get the stop sequence for that trip.
3. Pick any stop from the sequence whose scheduled time is still in the future.
4. Call `/stop-predictions?stop_id=<stop_id>` immediately.
5. Search the response for the cancelled `trip_id`.
   - If found with `status: "cancelled"` → Behaviour A confirmed. Update this ADR and tick the issue acceptance criterion.
   - If absent → Behaviour B confirmed. Update ADR and adjust the Worker's cancellation detection to cross-reference `/trip-cancellations` at runtime.

**Monitoring stop:** `6001` (Wellington Station Stop C) serves route 17. Its current trip_id pattern for route-17 outbound departures is `17__0__4xx__TZM__...`. This stop can be polled during a live cancellation window.

### `/trip-cancellations` endpoint

A separate endpoint provides advance and historical cancellation data:

```
GET /trip-cancellations?date_start=YYYY-MM-DDTHH:mm:ss&date_end=YYYY-MM-DDTHH:mm:ss
```

Sample record:

```json
{
  "id": "a7e297d9-bfd2-41d3-85d3-c9642bf343db",
  "trip_id": "1__1__116__TZM__232__232_20260419",
  "route_id": 10,
  "trip_date_start": "2026-05-22 07:00:00",
  "trip_date_end": "2026-05-22 08:21:00",
  "reinstated": 0,
  "part_cancellation": 0
}
```

The `trip_id` here matches the `trip_id` field in `/stop-predictions`, enabling cross-reference. The Worker does **not** need to call this endpoint at runtime — `status: "cancelled"` in `/stop-predictions` is the real-time signal. The `/trip-cancellations` endpoint is useful for testing/seeding the cancelled-service rendering code.

---

## Rate limits and KV cache interaction

| Parameter | Value |
|---|---|
| Sustained rate limit | 10 req/s |
| Burst limit | 20 req |
| Response `cache-control` | `no-store, no-cache` (Metlink never caches) |
| KV cache TTL | 30 s |
| Observed latency (Auckland CloudFront pop `AKL53-P3`) | 410–560 ms |

**Interaction analysis:**

The household has at most 2 radiators (`bedroom-philip-tania`, `bedroom-daughter`), each with up to 2 transit targets = maximum 4 Metlink calls per Worker invocation. Even if both radiators wake simultaneously (unlikely — they're independent), that's 4 calls within a 30-second window, well within the burst budget of 20.

At the PRD's maximum of 5 radiators with 2 targets each, a pathological simultaneous-wake burst could reach 10 calls — still within the burst limit with 10 remaining. Normal steady-state would stagger naturally.

**The KV cache TTL of 30 s is not driven by rate-limit concerns** — the household never approaches the limit. The TTL exists to:
1. Avoid Metlink fetch latency (~500 ms) on every radiator wake when multiple radiators share the same transit target.
2. Reduce calls to zero during the `minimal_clock` profile phase (cache is bypassed for that layout anyway, per the PRD).

**Response headers:** Metlink's `cache-control: no-store, no-cache` confirms the API never serves a cached response. Every Worker call that misses the KV cache hits Metlink's origin. This makes the KV cache the sole latency shield.

---

## Impact on config schema

The spike revealed that stop `3234` (Westchester) returns departures for multiple routes (`1`, `19`, `N5`) in a single response. The Worker cannot know which route the user wants without a `service_id` filter. The PRD config schema must be extended:

**Current** (PRD v0.4):
```yaml
transit_targets:
  bus:
    stop_id: "3234"
    time_to_stop_mins: 7
    comfort_buffer: 3
```

**Required** (add `service_id`):
```yaml
transit_targets:
  bus:
    stop_id: "3234"
    service_id: "1"
    time_to_stop_mins: 7
    comfort_buffer: 3
  train:
    stop_id: "TAKA1"
    service_id: "KPL"
    time_to_stop_mins: 15
    comfort_buffer: 4
```

The PRD placeholder stop IDs (`"7104"`, `"5112"`, `"WELL"`) should also be replaced with the validated real IDs from this spike.

---

## Consequences

### Positive

- **Single endpoint** for all modes. No separate train API; the Worker has one code path for both bus and train.
- **All state signals present** in one response: `status` carries `null` / `"delayed"` / `"cancelled"`; `arrival.expected` carries the realtime time; `delay` carries the magnitude. No secondary call needed at render time.
- **Robust fallback chain:** `monitored: false` is common (train tracking activates within ~30 min of scheduled departure). The Worker gracefully falls back to `arrival.aimed` when `expected` is null.

### Negative / follow-ups

- **`service_id` must be added to the config schema** (PRD v0.5 bump needed). Without it, the Worker cannot determine which route to display when a stop serves multiple services.
- **Cancelled service payload not live-captured.** The `status: "cancelled"` path is inferred from API structure, not a live sample. A deliberate follow-up investigation found no live cancellations available (see Cancellation handling section for the reproduction methodology using stop `6001` and route 17). This must be confirmed before the cancelled-service rendering ships — confirm the exact string value (`"cancelled"` vs `"CANCELED"` vs `"canceled"`) and confirm Behaviour A vs B.
- **Origin stop edge case.** At origin stops, `arrival.aimed` is absent; only `departure.aimed` is populated. The Worker must null-coalesce: `arrival.aimed ?? departure.aimed`. The household's current transit targets are mid-route stops and are unaffected, but this will matter for any origin stop added later.
- **Delay ISO 8601 parsing required.** The Worker must parse `"PT6M12S"` into seconds. A regex or a lightweight ISO 8601 duration parser is needed; the string is not a plain integer.
- **No rate-limit response headers.** The Worker cannot detect approaching the rate limit from response metadata. Rely on the KV cache to keep call volume low, and monitor for HTTP 429 responses defensively.
- **PRD config stop IDs need updating.** The placeholder IDs in PRD v0.4 (`"7104"`, `"5112"`, `"WELL"`) must be replaced with the validated real IDs (`"3234"`, `"TAKA1"`) and `service_id` fields added.

---

## Verified stop IDs

| Config location | Mode | `stop_id` | `service_id` | Human name | Validated |
|---|---|---|---|---|---|
| `philip_and_tania.morning_commute.train` | train | `TAKA1` | `KPL` | Takapu Rd Station (KPL line, Waikanae→Wellington) | ✓ live data 2026-05-23 |
| `philip_and_tania.morning_commute.bus` | bus | `3234` | `1` | Westchester Dr at Waitohi Rd (route 1 to Island Bay) | ✓ live data 2026-05-23 |
| `daughter_school.morning_school_run.bus` | bus | — | — | Not validated in this spike | ✗ |
| `philip_and_tania.evening_return.train` | train | — | — | Not validated in this spike | ✗ |

---

## References

- [PRD v0.4](../PRD/GottaGo%20PRD%20v0.4.md) §6 (exception states), §7 (KV cache TTL), §8 (architecture)
- [Glossary](../glossary.md) — `catchable service`, `delayed service`, `cancelled service`, `KV cache`, `wake cycle`
- [Metlink Open Data API Swagger](../../docs/metlink-api-swagger.json)
- Bruno collection: [`../../poc/metlink/Metlink/`](../../poc/metlink/Metlink/)
- Related issues: #5 (`priority_split` slice), #7–#10 (exception state slices)
