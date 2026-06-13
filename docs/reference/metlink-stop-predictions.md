# Reference: Metlink `/stop-predictions`

Reference for the Metlink gateway — field maps, sample payloads, rate limits, cancellation methodology, and verified stop IDs, captured from the 2026-05-23 live spike (against the household's `TAKA1` train and `3234` bus targets).

Source of truth for the wire shape is the gateway code — [`src/worker/gateways/metlink/wire-types.ts`](../../src/worker/gateways/metlink/wire-types.ts), [`mapper.ts`](../../src/worker/gateways/metlink/mapper.ts), and [`fixtures.ts`](../../src/worker/gateways/metlink/fixtures.ts). When that code and this document disagree, the code wins; update this doc.

The Swagger definition lives at [`../metlink-api-swagger.json`](../metlink-api-swagger.json).

## How GottaGo uses this endpoint

Three facts about the API shape the integration; none had a real alternative, so they live here rather than in an ADR:

1. **One endpoint for all modes.** `GET /stop-predictions?stop_id=<id>` serves bus and train alike — there is no separate train endpoint, and the response structure is identical regardless of mode. All state signals (`status`, `arrival.expected`, `delay`) arrive in this one response; no secondary call is needed at render time.
2. **Filter by `service_id` client-side.** The `service_id` query parameter is silently ignored by the API — it returns every route through the stop. The Worker filters after fetch.
3. **`service_id` is a config field** (`transit_targets.<mode>.service_id`, type `string | string[]` — an array matches any listed route, for journeys served by several route numbers). Without it the Worker cannot know which route to display at a multi-route stop like `3234` (routes `1`, `19`, `N5`). Implemented in `src/worker/config/config-types.ts`.

No caching layer exists ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)); every `priority_split` frame calls Metlink directly, which is well within its rate-limit headroom at household scale (see [Rate limits and call volume](#rate-limits-and-call-volume) below).

## API contract

### Authentication

- **Header:** `x-api-key: <key>` (request header, not query parameter).
- **Rate limits:** 10 requests/second sustained, burst of 20. No rate-limit headers appear in responses — limits are documented only, not machine-readable.

### Endpoint

```
GET https://api.opendata.metlink.org.nz/v1/stop-predictions?stop_id=<stop_id>&limit=<n>
```

- `stop_id` — required. Accepts both numeric bus stop codes (e.g. `3234`) and alphanumeric train station codes (e.g. `TAKA1`).
- `limit` — optional. Omitting it returns the full day's departures (~25–50 entries). Request only what you need (e.g. `limit=5`).
- `service_id` — **NOT a real filter.** Silently ignored by the API; omit it and filter client-side.

### Response envelope

```json
{
  "farezone": "4",
  "closed": false,
  "departures": [ ... ]
}
```

`closed: true` means the stop is temporarily closed — treat as a **no-service state**.

## Field mapping

All fields live at `departures[n].<field>`.

| GottaGo concept | Field path | Type | Notes |
|---|---|---|---|
| **Route code** | `service_id` | string | e.g. `"KPL"`, `"1"`. Used as the column header route code. |
| **Scheduled arrival** | `arrival.aimed` | ISO 8601 string | Always present at mid-route stops. e.g. `"2026-05-23T06:48:00+12:00"`. |
| **Predicted arrival** | `arrival.expected` | ISO 8601 string or null | `null` when `monitored: false`. Fall back to `arrival.aimed`. |
| **Delay magnitude** | `delay` | ISO 8601 duration string | Always present. `"PT0S"` = on time. `"PT6M12S"` = 6 min 12 sec late. Parse to seconds, round to nearest minute. |
| **Service state** | `status` | string or null | `null` = normal/scheduled. `"delayed"` = delayed. `"cancelled"` = cancelled (inferred — see Cancellation handling). |
| **Live tracking active** | `monitored` | boolean | `true` = tracked, `expected` populated. `false` = scheduled only, `expected` null. |
| **Trip identity** | `trip_id` | string | Cross-references `/trip-cancellations`. |

### `arrival` vs `departure`

At **mid-route stops** (e.g. `TAKA1`, `3234`), `arrival.aimed` and `departure.aimed` are identical — Metlink does not model dwell time. Use the `arrival.*` fields.

At **origin stops** (first stop of a route), `arrival` only contains `{expected: null}` — the `aimed` key is absent. `departure.aimed` is the only source of the scheduled time (verified against stop `6001`, Wellington Station Stop C).

**Extraction rule** — handles mid-route, origin, and the `monitored: false` fallback in one expression:

```
scheduled_time = arrival.aimed ?? departure.aimed
realtime_time  = arrival.expected ?? departure.expected ?? scheduled_time
```

The household's current transit targets (`TAKA1`, `3234`) are both mid-route, so the origin edge case does not affect the morning commute today — but it will matter if an origin stop is ever added.

## Sample payloads

### Delayed train departure (`status: "delayed"`, `monitored: true`)

```json
{
  "stop_id": "TAKA1",
  "service_id": "KPL",
  "delay": "PT6M12S",
  "arrival": { "aimed": "2026-05-23T05:48:00+12:00", "expected": "2026-05-23T05:54:12+12:00" },
  "status": "delayed",
  "monitored": true,
  "trip_id": "KPL__1__6407__RAIL__Rail_Sa_20260419"
}
```

Render `DELAYED +6 MIN` (round `PT6M12S`). Use `arrival.expected` for arrival time and recompute Leave In / Leave By against it.

### Scheduled-only train departure (`status: null`, `monitored: false`)

```json
{
  "stop_id": "TAKA1",
  "service_id": "KPL",
  "delay": "PT0S",
  "arrival": { "aimed": "2026-05-23T06:48:00+12:00", "expected": null },
  "status": null,
  "monitored": false
}
```

Normal display. Use `arrival.aimed` (no live data yet).

### Bus departure (`service_id: "1"`, multi-route stop)

```json
{
  "stop_id": "3234",
  "service_id": "1",
  "delay": "PT0S",
  "arrival": { "aimed": "2026-05-23T06:51:00+12:00", "expected": null },
  "status": null,
  "monitored": false
}
```

Stop `3234` serves routes `1`, `19`, and `N5` in a single response. Client-side filter on `service_id` is required.

## Cancellation handling

**Unconfirmed against live data.** A 2026-05-23 follow-up found no live cancellations to observe (`/trip-cancellations` returned only completed trips; `/gtfs-rt/tripupdates` and `/servicealerts` carried none). Two possible behaviours:

| Behaviour | What the Worker sees | Consequence |
|---|---|---|
| **A — trip retained** (`status: "cancelled"`) | Entry present, `status == "cancelled"` | Worker detects the cancellation, renders the struck-through display. |
| **B — trip removed** (silently absent) | Entry disappears | Worker cannot distinguish cancelled from departed; cancelled-service screen never renders. |

Behaviour A is assumed (the API already uses `status` for `"delayed"`, and GTFS-RT uses `ScheduleRelationship.CANCELED`), but **must be confirmed before the cancelled-service rendering path ships** — including the exact string value (`"cancelled"` vs `"CANCELED"` vs `"canceled"`).

### Reproduction methodology

When a route-17 cancellation is announced (route 17 had 5+ consecutive cancellations on 2026-05-22):

1. `GET /trip-cancellations?date_updated=<today>` to find the `trip_id`.
2. `GET /gtfs/stop_times?trip_id=<trip_id>` for the stop sequence.
3. Pick a stop whose scheduled time is still in the future.
4. `GET /stop-predictions?stop_id=<stop_id>` immediately, search for the cancelled `trip_id`.
   - Found with `status: "cancelled"` → Behaviour A confirmed.
   - Absent → Behaviour B confirmed; cross-reference `/trip-cancellations` at runtime instead.

**Monitoring stop:** `6001` (Wellington Station Stop C) serves route 17.

The Worker does **not** call `/trip-cancellations` at runtime — `status: "cancelled"` in `/stop-predictions` is the real-time signal. The endpoint is useful only for testing/seeding the cancelled-service rendering code. Its `trip_id` matches the `/stop-predictions` `trip_id`.

## Rate limits and call volume

| Parameter | Value |
|---|---|
| Sustained rate limit | 10 req/s |
| Burst limit | 20 req |
| Response `cache-control` | `no-store, no-cache` (Metlink never caches) |
| Observed latency (Auckland pop `AKL53-P3`) | 410–560 ms |

At the household scale (≤5 radiators × 2 targets = 10 calls per pathological simultaneous wake) there is ~50× headroom. No caching layer exists ([ADR-0010](../adr/0010-no-metlink-cache-layer.md)); every `priority_split` frame pays the full ~500 ms Metlink latency, which is acceptable for a background refresh. There are no rate-limit response headers, so monitor for HTTP 429 defensively.

## Verified stop IDs

| Config location | Mode | `stop_id` | `service_id` | Human name | Validated |
|---|---|---|---|---|---|
| `philip_and_tania.morning_commute.train` | train | `TAKA1` | `KPL` | Takapu Rd Station (KPL line, Waikanae→Wellington) | ✓ live 2026-05-23 |
| `philip_and_tania.morning_commute.bus` | bus | `3234` | `1` | Westchester Dr at Waitohi Rd (route 1 to Island Bay) | ✓ live 2026-05-23 |
| `daughter_school.morning_school_run.bus` | bus | `3234` | `["634", "635"]` | Westchester Drive at Waverton Terrace (routes 634/635 to Newlands College) | ✓ GH #16 |
| `philip_and_tania.evening_return.train` | train | — | — | Not validated in this spike | ✗ |
