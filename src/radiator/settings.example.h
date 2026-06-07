#pragma once

// Copy this file to a per-deployment variant and fill in real values:
//
//   cp settings.example.h settings.h.<variant>
//
//   e.g. settings.h.dev           # local Worker (cloudflared tunnel)
//        settings.h.parents-home  # bedroom radiator, deployed Worker
//        settings.h.f5            # office radiator, deployed Worker
//        settings.h.f5-tui        # same office device on the home WiFi
//
// flash.sh discovers variants from the settings.h.<variant> files present —
// any <variant> with a file is a valid argument and `./flash.sh` with no
// argument lists them — so adding a radiator never means editing the script.
// `./flash.sh <variant>` copies the variant onto settings.h — the file the
// sketch #includes. That settings.h is generated/throwaway; edit the
// variants, not it.
//
// settings.h* are all gitignored. The sketch #includes settings.h, so it will
// not compile until `./flash.sh <variant>` has generated it (or you cp one by
// hand).
//
// The WIFI_SSID and WIFI_PASSWORD here are the same ones used by the
// wake-cycle PoC; if poc/lilygo/wake-cycle-32/secrets.h already exists on
// this machine, copy those two lines straight from it.

#define WIFI_SSID     "your-ssid"
#define WIFI_PASSWORD "your-password"

// The Worker's /v1/frame endpoint. For local development, this is the
// cloudflared quick tunnel URL printed by `cloudflared tunnel --url
// http://localhost:8787` (see README §"Reach the Worker"). The path must
// include /v1/frame; the tunnel URL is the scheme + host.
#define FRAME_URL "https://your-quick-tunnel.trycloudflare.com/v1/frame"

// Shared token (RADIATOR_SHARED_TOKEN) — must match the Worker's
// configured value, otherwise the Worker returns 401 + X-Sleep-Seconds: 3600
// and the panel is not updated (per ADR-0003).
#define RADIATOR_TOKEN "test-token-123"

// This radiator's slug. Must resolve to a known entry in the Worker's
// radiators: config, otherwise the Worker returns 404 + X-Sleep-Seconds: 3600.
#define RADIATOR_SLUG "bedroom-philip-tania"

// Verbose error screen. When the Worker returns an error, the radiator renders
// a generic on-panel error screen from the problem+json body (ADR-0011): the
// `title` as heading and `detail` as body. Set this to 1 to also render the raw
// upstream snippet (`upstream_detail`, present on metlink-* errors) underneath —
// a debugging aid. Leave at 0 for normal operation.
#define RADIATOR_VERBOSE 0

// Optional dev-only time override. Uncomment and set an ISO 8601 timestamp to
// make the Worker resolve the profile phase against that instant instead of
// real time — e.g. to preview the morning_school_run layout outside its
// 07:15–08:30 window. Requires the Worker to run with DEV_TIME_OVERRIDE=true.
// Leave commented for normal operation.
// #define DEBUG_NOW "2026-06-01T07:30:00+12:00"
