/**
 * battery.{h,cpp} — the radiator's battery-voltage sample (GH #79).
 *
 * One function: sampleBatteryMv() takes the validated PoC reading recipe
 * (poc/lilygo/battery-level) — epd_poweron() → settle → average of 8 ×
 * analogReadMilliVolts(GPIO 14) × 2 → epd_poweroff() — and returns the raw
 * millivolts the orchestrator hands to fetchFrame() as X-Radiator-Battery-Mv.
 *
 * ⚠ Ordering is a hard constraint: GPIO 14 is an ADC2 channel,
 * which the ESP32-S3 Wi-Fi driver owns while the radio is up. The sample MUST
 * complete before connectWiFi() — that also dodges radio-TX voltage sag.
 *
 * Device-only (ADC + panel rail), so it is not part of the host test build —
 * same exclusion as net.cpp.
 */
#pragma once

#include <cstdint>

// Sample the battery voltage as a self-contained power pulse and return the
// averaged reading in raw millivolts. 0 means "no reading" — the caller omits
// the header (mirrors the hardware-id omission guard). No other filtering:
// USB power and a floating divider both produce plausible values the firmware
// cannot distinguish — interpretation is the Worker's job.
uint32_t sampleBatteryMv();
