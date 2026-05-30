#pragma once

// Copy this file to secrets.h and fill in real values:
//
//   cp secrets.example.h secrets.h
//
// secrets.h is gitignored. The sketch #includes it, so it will not compile
// until that file exists.
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

// Optional dev-only time override. Uncomment and set an ISO 8601 timestamp to
// make the Worker resolve the profile phase against that instant instead of
// real time — e.g. to preview the morning_school_run layout outside its
// 07:15–08:30 window. Requires the Worker to run with DEV_TIME_OVERRIDE=true.
// Leave commented for normal operation.
// #define DEBUG_NOW "2026-06-01T07:30:00+12:00"
