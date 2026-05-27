#pragma once

// Copy this file to secrets.h and fill in real values:
//
//   cp secrets.example.h secrets.h
//
// secrets.h is gitignored — credentials never get committed. The sketch
// #includes secrets.h, so it will not compile until that file exists.

#define WIFI_SSID     "your-ssid"
#define WIFI_PASSWORD "your-password"

// Any reachable HTTPS endpoint. For the GottaGo frame fetch this becomes the
// Worker URL (poc/worker-helloworld, once deployed); https://example.com/ works
// as a generic TLS + GET smoke test in the meantime.
#define FRAME_URL     "https://example.com/"
