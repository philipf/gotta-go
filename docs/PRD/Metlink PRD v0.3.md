# Product Requirements Document (PRD): Home Transit Radiator
**Version:** 0.3  
**Previous version:** [v0.2](Metlink%20PRD%20v0.2.md)

---

## 1. Problem Statement & Context

Navigating public transport applications during a busy morning routine introduces unnecessary cognitive load and friction. Standard mobile transit applications are overly complex, requiring manual navigation, fumbling with phones, and active mental calculation of timetables.

When users are fatigued, rushing, or managing varying household schedules, they lack a glanceable, ambient representation of transit data that factors in their physical proximity to transit hubs. This solution provides a zero-intervention "information radiator" that translates real-time transport data into immediate, context-aware visual cues distributed throughout the home.

## 2. User Personas

* **The Commuting Professionals (Philip & Tania):** Require multi-modal transit options (Bus and Train) tracked simultaneously side-by-side, adapting dynamically based on the morning commute windows, workday focus hours, and evening return periods.
* **The School Commuter (Daughter):** Requires a dedicated, simplified, single-mode transit stream (Bus only) focusing purely on her specific school run timeline without additional visual clutter.

## 3. Success Factors
* **Zero-Intervention UI:** The consumer interface requires absolutely no physical interaction or fumbling to display context-relevant morning data.
* **Math-Free Urgency:** A single glance tells a user whether they can catch a service based on walking buffers, eliminating mental countdown calculations.
* **Ultra-High Scalability:** New devices can be added to the network instantly without requiring localized firmware updates when third-party APIs change.
* **High Ambient Blending:** Enclosures and displays seamlessly blend into household environments (bedside, fridge) without emitting disruptive light.

## 4. Hardware Specification

| Component                 | Specification                                                                                | Estimated Cost (NZD) |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------- |
| **Display Panel & Board** | LilyGO T5 Integrated 4.7-inch Electronic Paper (E-ink) Display Board with on-board ESP32-S3. | ~$68.00              |
| **Power Source**          | Rechargeable Lithium Polymer (LiPo) battery pack (e.g., 2000mAh).                            | ~$10.00              |
| **Enclosure & Mounting**  | Custom 3D-printed chassis featuring rear recess slots for neodymium magnets. Oriented for landscape (horizontal) mounting. | ~$5.00               |
| **Total Estimated Cost**  | **Per-unit production hardware stack**                                                       | **~$83.00 NZD**      |

**Display Specification:** Native resolution 960×540px, operated in landscape orientation. All rendered canvases must match this exact resolution for native 1-bit EPD buffer flushing.

## 5. Screen Layout Specification

### 5.1 `priority_split` Layout (1 or 2 columns)

The canvas is divided into a **global header strip** (~8% of height) and a **content area** below it. When two transit targets are configured, the content area splits into two equal vertical columns. When only one transit target is configured, it expands to full width automatically.

**Global Header Strip:**
- Current wall-clock time (24-hour format, HH:MM) — centred, small pixel font.

**Per-Column Layout (top to bottom):**
1. **Mode icon + route identifier** (~20% of column height) — e.g., `BUS 22` or `TRAIN HVL`. Large, bold.
2. **Primary service countdown** (~40% of column height) — dominant pixel-font number, e.g., `4 MIN`, with the clock-time arrival shown below in smaller font, e.g., `07:14`.
3. **Walk-window progress bar** (~10% of column height) — horizontal bar representing the safety margin: full when `(minutes_to_departure - time_to_stop_mins) = comfortable_buffer_factor × time_to_stop_mins`, draining to zero at the exact moment `minutes_to_departure == time_to_stop_mins` (the urgency threshold). See Section 5.3.
4. **Next service backup** (~15% of column height) — small text showing the next catchable service, e.g., `then 07:24 · 22`. Displays `—` if no second service is available.

**Urgency State (replaces primary countdown section):**
When the countdown reaches `time_to_stop_mins`, the entire column inverts to solid black with a bold `LEAVE NOW` pixel-font banner and the route identifier.

**Service Promotion:**
When the primary service becomes uncatchable (countdown drops below `time_to_stop_mins`), it is removed and the backup service is promoted to the primary slot. The backup slot then shows `—` until the next wake cycle fetches a new backup.

**No-Service State:**
When zero catchable services exist within 60 minutes, the column displays `NO SERVICE` in the primary slot with the next available departure time below it (e.g., `Next: 06:14`).

### 5.2 `minimal_clock` Layout

Full-screen centred layout:
- **Large pixel-font time** (24-hour, HH:MM) — dominant, centred vertically and horizontally.
- **Current date** in smaller font below (e.g., `Fri 16 May`).
- No transit data, no progress bar. The Worker short-circuits all Metlink API and KV cache calls for this layout.

### 5.3 Progress Bar Calculation

```
safety_margin = minutes_to_departure - time_to_stop_mins
full_bar_value = comfortable_buffer_factor × time_to_stop_mins
bar_fill_ratio = clamp(safety_margin / full_bar_value, 0, 1)
```

The bar is full when the service is comfortably far away and depletes linearly to zero at the urgency threshold.

### 5.4 Typography

All text rendered using **Press Start 2P** (Google open-source bitmap font), bundled as a static Worker asset. This font is pixel-grid aligned and renders crisply without anti-aliasing on 1-bit monochrome canvases. Recommended size guide:
- Large countdown: ~120px
- Mode/route label: ~24px
- Arrival time / backup service: ~16px
- Header clock: ~20px

---

## 6. Functional Requirements (EARS Format)

* **While** the system is in `morning_commute` state for a dual-mode profile, the system **shall** display the **Dual-Gauge Pixel Dashboard** split evenly into side-by-side vertical columns for Bus and Train as defined in Section 5.1.
* **While** the system is in `morning_school_run` state for a single-mode profile, the system **shall** scale the `priority_split` layout to a full-width single-column view dedicated exclusively to the configured bus route.
* **While** the system is in `workday_focus` or `afternoon_idle` state, the system **shall** display the `minimal_clock` layout (Section 5.2), updated per the configured refresh interval, and **shall not** issue any Metlink API or KV cache requests.
* **When** the walk-window progress bar (Section 5.3) reaches zero, the system **shall** trigger the `urgency_filter`, inverting that column to solid black with a bold `LEAVE NOW` pixel-font banner.
* **When** the primary service becomes uncatchable, the system **shall** promote the pre-fetched backup service to the primary visual slot. If no backup exists, the slot **shall** display `—`.
* **When** no catchable services exist within 60 minutes, the system **shall** display `NO SERVICE` with the next available departure time.
* **When** a client device boots or wakes from deep sleep, the system **shall** send its slug identifier via the `X-Device-User` header and a shared token via `X-Device-Token` to the Worker. The Worker **shall** reject requests missing a valid `X-Device-Token`.
* **When** the Worker processes a valid request, it **shall** use server-side time (converted to the configured timezone) to determine the active profile window — no client-side time synchronisation is required.
* **When** the Worker returns a rendered image, it **shall** include an `X-Sleep-Seconds` response header. The client device **shall** enter deep sleep for exactly this duration without any local schedule evaluation.

## 7. Non-Functional Requirements (EARS Format)

### Performance & Data Fetching
* **When** a client device requests transit data, the Cloudflare Worker backend **shall** query the Cloudflare KV cache first.
* **When** the Cloudflare KV cache data is older than 30 seconds, the backend **shall** issue a single request to the Metlink GTFS-Realtime API, update the cache, and return the image stream to protect API rate limits.
* **When** the active layout is `minimal_clock`, the Worker **shall** bypass KV cache and Metlink API calls entirely and return a clock image immediately.
* **When** the image processing routine executes, the TypeScript Worker **shall** render layout elements using **Satori** (for Press Start 2P font rendering and CSS-based layout) and encode the final output as a flattened 1-bit monochrome BMP byte array at 960×540px resolution via manual BMP byte construction, optimised for direct native flushing by the LilyGO T5 panel.

### Power Management & Lifecycle
* **While** operating in an active morning commute state, the client device **shall** wake from deep sleep, flash the screen, and return to sleep per the interval specified in `X-Sleep-Seconds` (typically 2–3 minutes).
* **While** operating in an inactive afternoon or idle state, the client device **shall** increase its deep sleep cycle to 30 minutes to aggressively preserve battery health.

### Error Handling
* **When** a client device cannot reach the Worker (Wi-Fi failure, network error, or unexpected response), the device **shall** take no action — the e-ink display retains its last valid frame indefinitely without power. The device **shall** silently retry on the next scheduled wake cycle.

### Pre-Implementation Spikes Required
* The specific Metlink GTFS-Realtime API endpoints, response shapes, and field mappings for bus stop predictions (`stop_id`) and train station departures (`station_id`) must be validated against the live API before Worker implementation begins.
* The TypeScript BMP rendering pipeline must be validated end-to-end in a Cloudflare Workers environment before full Worker implementation begins. The spike must confirm: Satori rendering with the Press Start 2P TTF asset produces pixel-accurate output at the required sizes; the manual 1-bit BMP encoder correctly encodes the rasterised pixel data; and the resulting BMP byte stream is faithfully flushed by the LilyGO T5 EPD panel without artefacts.

## 8. High-Level Architecture & Solution Design

The system follows a **"Dumb Client, Smart Edge"** architectural pattern. The physical LilyGO T5 hardware does zero data processing, JSON parsing, schedule evaluation, or layout math. Instead, it offloads all computational and rendering complexity to a serverless Cloudflare Worker, which determines the active profile from server time, computes transport timelines, and returns a raw, ready-to-flash 1-bit bitmap image alongside sleep duration instructions.

### Technology Stack
* **Edge Compute:** Cloudflare Workers (TypeScript).
* **Caching Layer:** Cloudflare KV (Key-Value) Storage (30-second TTL for Metlink API responses).
* **Graphics Engine:** **Satori** for CSS-driven layout and Press Start 2P font rendering (TTF bundled as a static Worker asset), producing an intermediate SVG. The SVG pixel data is then encoded into a 1-bit monochrome BMP byte array via manual BMP byte construction — zero native dependencies, sub-millisecond encode time.
* **Firmware:** C++/Arduino ESP-IDF framework running on the LilyGO T5 (handles Wi-Fi connection, HTTP fetching, deep sleep management, and raw E-paper EPD buffer flushing).
* **External Data:** Metlink Wellington Open Data API (GTFS-Realtime predictions).

### Request / Response Contract

| Direction | Mechanism | Purpose |
|-----------|-----------|---------|
| Device → Worker | `X-Device-User: <slug>` header | Identifies device; Worker resolves to profile via `devices` config |
| Device → Worker | `X-Device-Token: <secret>` header | Shared static token; Worker rejects requests without a valid value |
| Worker → Device | HTTP body (binary BMP) | Ready-to-flush 1-bit 960×540 bitmap |
| Worker → Device | `X-Sleep-Seconds: <n>` header | Deep sleep duration; device sleeps this exact duration |

### Profile Resolution Flow (Worker)
1. Validate `X-Device-Token`.
2. Look up `X-Device-User` slug in `devices` config → resolve to profile key.
3. Convert server UTC time to `global.timezone`.
4. Match current time against profile windows → determine active layout.
5. If `minimal_clock`: render clock image, return immediately (no Metlink call).
6. If transit layout: check KV cache → fetch Metlink if stale → render image.
7. Return BMP + `X-Sleep-Seconds`.

## 9. Relevant Configuration Files

### Master Configuration (`config.yaml`)

```yaml
# Global platform configurations
global:
  timezone: "Pacific/Auckland"
  default_refresh_interval_minutes: 3

# Device Registry
# Maps device slug (sent via X-Device-User header) to a user profile key.
# Slug (device-id) is hardcoded as a compile-time constant in each device's firmware.
devices:
  bedroom-philip-tania:
    profile: "philip_and_tania"
  bedroom-daughter:
    profile: "daughter_school"
  # Add additional device entries here (up to 5 total)

# User & Device Profiles
users:
  philip_and_tania:
    morning_commute:
      start_time: "06:30"
      end_time: "09:00"
      refresh_interval_minutes: 2
      layout: "priority_split"
      show_progress_bar: true
      urgency_filter: true
      transit_targets:
        bus:
          stop_id: "7104"
          time_to_stop_mins: 7       # Walking — predictable, low variance
          comfortable_buffer_factor: 3
        train:
          station_id: "WELL"
          time_to_stop_mins: 15      # Driving — subject to traffic variance
          comfortable_buffer_factor: 4

    workday_focus:
      start_time: "09:00"
      end_time: "16:00"
      refresh_interval_minutes: 1   # 1-minute ticks for desk clock accuracy
      layout: "minimal_clock"
      show_progress_bar: false
      urgency_filter: false

    evening_return:
      start_time: "16:00"
      end_time: "19:00"
      refresh_interval_minutes: 3
      layout: "priority_split"      # Single-column auto-scales for one target
      show_progress_bar: true
      urgency_filter: false
      transit_targets:
        train:
          station_id: "WELL"
          time_to_stop_mins: 10
          comfortable_buffer_factor: 4

  daughter_school:
    morning_school_run:
      start_time: "07:15"
      end_time: "08:30"
      refresh_interval_minutes: 2
      layout: "priority_split"
      show_progress_bar: true
      urgency_filter: true
      transit_targets:
        bus:
          stop_id: "5112"
          time_to_stop_mins: 5
          comfortable_buffer_factor: 3

    afternoon_idle:
      start_time: "08:30"
      end_time: "21:00"
      refresh_interval_minutes: 30  # Aggressive battery conservation
      layout: "minimal_clock"
      show_progress_bar: false
      urgency_filter: false
```

### Cloudflare Worker Manifest (`wrangler.toml`)

```toml
name = "transit-radiator-backend"
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
#   wrangler secret put DEVICE_SHARED_TOKEN
```

## 10. Deployment Checklist

Before first deployment, the following must be completed in order:

- [ ] Run BMP rendering spike: validate Satori + Press Start 2P TTF output and manual 1-bit BMP encoder against the LilyGO T5 EPD panel (see Section 7 spike requirement).
- [ ] Validate Metlink GTFS-Realtime API endpoints for `stop_id` (bus) and `station_id` (train) — confirm field names and response shapes against the live API.
- [ ] Create Cloudflare KV namespace and replace `prod_metlink_cache_kv_id_here` in `wrangler.toml` with the real ID.
- [ ] Set Worker secrets: `wrangler secret put METLINK_API_KEY` and `wrangler secret put DEVICE_SHARED_TOKEN`.
- [ ] Bundle Press Start 2P TTF font file as a static Worker asset.
- [ ] Flash each device firmware with its assigned slug (matching an entry in the `devices` config) and the `DEVICE_SHARED_TOKEN` value as compile-time constants.
- [ ] Deploy Worker: `wrangler deploy`.

## 11. Deferred / Future Work

* **Battery level indicator:** Requires the device to pass its current charge level as a query parameter to the Worker. Deferred to a future version to keep the initial firmware simple and maintain the dumb-client contract.
* **Battery life validation for `workday_focus`:** The 1-minute refresh cycle during a 7-hour workday on a 2000mAh LiPo has not been empirically validated. If battery drain is unacceptable, options are: increase the interval, show date only, or remove the workday clock feature.
