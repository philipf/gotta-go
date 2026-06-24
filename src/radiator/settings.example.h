#pragma once

// Copy this file to a per-deployment variant and fill in real values:
//
//   cp settings.example.h settings.<variant>.h
//
//   e.g. settings.dev.h           # local Worker (cloudflared tunnel)
//        settings.parents-home.h  # bedroom radiator, deployed Worker
//        settings.f5.h            # office radiator, deployed Worker
//        settings.f5-tui.h        # same office device on the home WiFi
//
// (The .h extension comes last so editors apply C/C++ syntax highlighting.)
//
// flash.sh discovers variants from the settings.<variant>.h files present —
// any <variant> with a file is a valid argument ("example" excepted: this
// template is not flashable) and `./flash.sh` with no argument lists them —
// so adding a radiator never means editing the script. `./flash.sh <variant>`
// copies the variant onto settings.h — the file the sketch #includes. That
// settings.h is generated/throwaway; edit the variants, not it.
//
// settings.h and settings.<variant>.h are gitignored (only this example is
// tracked). The sketch #includes settings.h, so it will not compile until
// `./flash.sh <variant>` has generated it (or you cp one by hand).
//
// Secrets: write a pass-path placeholder of the form @pass:PATH@ (PATH is the
// `pass` entry name) instead of a literal value, and
// flash.sh resolves it from the `pass` store at flash time (into the generated
// settings.h), so the plaintext lives only in the password store — never in a
// settings file. A literal value still works if you prefer; the placeholder is
// only substituted when it's present. Any line can use it (WIFI_*, the token, …).

#define WIFI_SSID "@pass:work/<radiator>/wifi/ssid@"
#define WIFI_PASSWORD "@pass:work/<radiator>/wifi/password@"

// The Worker's /v1/frame endpoint. For local development, this is the
// cloudflared quick tunnel URL printed by `cloudflared tunnel --url
// http://localhost:8787` (see README §"Reach the Worker"). The path must
// include /v1/frame; the tunnel URL is the scheme + host.
#define FRAME_URL "https://gotta-go.notnot.uk/v1/frame"

// Shared token (RADIATOR_SHARED_TOKEN) — must match the Worker's
// configured value, otherwise the Worker returns 401 + X-Sleep-Seconds: 3600
// and the panel is not updated (per ADR-0003).
#define RADIATOR_TOKEN "@pass:gotta-go/prod/worker-api-token@"

// This radiator's slug. Must resolve to a known entry in the Worker's
// radiators: config, otherwise the Worker returns 404 + X-Sleep-Seconds: 3600.
#define RADIATOR_SLUG "bedroom-philip-tania"

// Verbose error screen. When the Worker returns an error, the radiator renders
// a generic on-panel error screen from the problem+json body (ADR-0011): the
// `title` as heading and `detail` as body. Set this to 1 to also render the raw
// upstream snippet (`upstream_detail`, present on metlink-* errors) underneath —
// a debugging aid. Leave at 0 for normal operation.
#define RADIATOR_VERBOSE 0

// Debug build (power/timing, not display — distinct from RADIATOR_VERBOSE).
// On wake the native USB CDC has re-enumerated and the host has not re-attached
// yet, so the radiator delays 1 s before logging the wake banner. That 1 s of
// active current per wake is pure waste on a battery radiator nobody is watching
// (GH #89). Set this to 1 on a development board (a dev settings variant) to keep
// the delay on every wake so timer-wake logs are visible over `tio`/`picocom`.
// Leave at 0 for deployed/battery radiators — the delay is still kept on cold
// boot (you just plugged in), only timer wakes skip it.
#define RADIATOR_DEBUG 0

// Optional dev-only time override. Uncomment and set an ISO 8601 timestamp to
// make the Worker resolve the profile phase against that instant instead of
// real time — e.g. to preview the morning_school_run layout outside its
// 07:15–08:30 window. Requires the Worker to run with DEV_TIME_OVERRIDE=true.
// Leave commented for normal operation.
// #define DEBUG_NOW "2026-06-01T07:30:00+12:00"
