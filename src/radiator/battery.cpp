#include "battery.h"

#include <Arduino.h>

#include "epd_driver.h"  // epd_poweron/epd_poweroff — the divider's rail gate

// LilyGo T5-4.7 ESP32-S3: battery /2 divider input — GPIO 14, the library's
// own BATT_PIN macro (which epd_driver.h brings in, hence the distinct name).
// ADC2 — see the header's Wi-Fi ordering constraint.
static const int BATTERY_ADC_PIN = 14;

// The divider is gated by the panel rail; give the ADC a beat after raising it
// (matches the LilyGo demo and the PoC).
static const uint32_t ADC_SETTLE_MS = 10;

// Single samples bounce ±10–20 mV; averaging keeps the value clean enough for
// the Worker-side rose-since-last-wake charging check. Reads are microseconds
// each, all inside the one power window.
static const int SAMPLE_COUNT = 8;

uint32_t sampleBatteryMv() {
    // Self-contained power pulse: raise the panel rail for the ~10 ms read and
    // drop it again — it does NOT stay up through the network phase.
    epd_poweron();
    delay(ADC_SETTLE_MS);
    // analogReadMilliVolts is the core's eFuse-calibrated read, doubled to undo
    // the /2 divider. Do NOT use the upstream demo's raw/4095 × 3.3 × vref
    // formula — its eFuse-Vref calibration is a no-op on the S3.
    uint32_t sum = 0;
    for (int i = 0; i < SAMPLE_COUNT; i++) {
        sum += analogReadMilliVolts(BATTERY_ADC_PIN) * 2;
    }
    epd_poweroff();

    const uint32_t mv = sum / SAMPLE_COUNT;
    Serial.printf("battery: %lu mV (avg of %d)\n", (unsigned long)mv, SAMPLE_COUNT);
    return mv;
}
