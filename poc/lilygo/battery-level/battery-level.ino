/**
 * GottaGo — LilyGO T5 4.7" EPD battery-level PoC
 *
 * Isolated spike: read the battery voltage on the LilyGo T5-4.7 (ESP32-S3),
 * show it as labels on the panel, and print both the calibrated and the
 * legacy-demo readings to serial. No Wi-Fi, no Worker, no headers — the
 * header contract is the production feature's problem.
 *
 * Hardware facts (from LilyGo-EPD47 src/utilities.h + examples/demo):
 *   - The battery sits behind a /2 voltage divider on GPIO 14 (S3 board).
 *   - POWER_EN must be high while sampling — epd_poweron() handles that.
 *
 * Arduino IDE board settings (copy from LilyGo-EPD47 examples):
 *   Board:            ESP32S3 Dev Module
 *   USB CDC On Boot:  Enable
 *   Flash Size:       16MB (128Mb)
 *   Flash Mode:       QIO 80MHz
 *   Partition Scheme: 16M Flash (3M APP/9.9MB FATFS)
 *   PSRAM:            OPI PSRAM
 *   Upload Mode:      UART0/Hardware CDC
 *   USB Mode:         Hardware CDC and JTAG
 */

#ifndef BOARD_HAS_PSRAM
#error "Enable PSRAM: Arduino IDE -> Tools -> PSRAM -> OPI"
#endif

#include <Arduino.h>
#include "epd_driver.h"
#include "firasans.h"

// LilyGo T5-4.7 ESP32-S3: battery divider input (utilities.h BATT_PIN).
// NOTE: this is an ADC2 channel, which the Wi-Fi driver owns while the radio
// is active. Fine here (no Wi-Fi); in the production firmware the sample must
// be taken before connectWiFi() — see README "Taking this into src/radiator".
#define BATT_PIN 14

// Re-sample cadence. Long enough to be kind to the panel, short enough to
// watch the value respond when USB is plugged/unplugged.
static const uint32_t SAMPLE_INTERVAL_MS = 10000;

// Crude linear display map: 3.30 V -> 0 %, 4.20 V -> 100 %. Good enough to
// eyeball the trend on the panel; a proper LiPo discharge curve (and where it
// lives — firmware vs Worker) is deliberately out of scope for this PoC.
static int batteryPercent(uint32_t mv) {
    if (mv <= 3300) return 0;
    if (mv >= 4200) return 100;
    return (int)((mv - 3300) * 100 / (4200 - 3300));
}

// Wall-power heuristic. The board routes no VBUS sense or charger status pin
// (HX6610S CHRG/STDBY only drive the indicator LEDs) to any GPIO, so the BAT
// pin is all we have. While charging, the charger drives it above a LiPo's
// natural ceiling — a reading at/above this means external power. Caveat: a
// full battery on a standby charger floats at ~4.2 V and reads as "battery".
static const uint32_t WALL_POWER_MV = 4250;

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("GottaGo battery-level PoC");

    epd_init();
    epd_poweron();
    epd_clear();

    int32_t cursor_x = 200;
    int32_t cursor_y = 120;
    writeln((GFXfont *)&FiraSans, "Battery level PoC", &cursor_x, &cursor_y, NULL);
    epd_poweroff();
}

void loop() {
    // POWER_EN gates the battery divider, so sample with the panel rail on,
    // and give the ADC a beat to settle (matches the LilyGo demo).
    epd_poweron();
    delay(10);

    // Primary reading: the core's eFuse-calibrated millivolt read, doubled to
    // undo the /2 divider.
    const uint32_t mv = analogReadMilliVolts(BATT_PIN) * 2;

    // Legacy reading: raw count through the formula the shipped LilyGo demo
    // uses. vref=1100 is the demo's fallback — the eFuse-Vref calibration it
    // tries to read only exists on the classic ESP32, never on the S3. Printed
    // for comparison only, to show how far the uncalibrated path drifts.
    const uint16_t raw = analogRead(BATT_PIN);
    const float legacyV = ((float)raw / 4095.0f) * 2.0f * 3.3f * (1100.0f / 1000.0f);

    const int pct = batteryPercent(mv);
    const bool onWall = mv >= WALL_POWER_MV;

    Serial.printf("battery: %lu mV (calibrated), ~%d%%, power=%s | raw=%u -> %.2f V (legacy demo formula)\n",
                  (unsigned long)mv, pct, onWall ? "wall" : "battery",
                  (unsigned)raw, legacyV);

    char line1[48];
    char line2[48];
    char line3[48];
    snprintf(line1, sizeof(line1), "Voltage: %lu mV", (unsigned long)mv);
    snprintf(line2, sizeof(line2), "Charge:  ~%d %%", pct);
    snprintf(line3, sizeof(line3), "Power:   %s", onWall ? "wall" : "battery");

    // Clear just the readings band and redraw, leaving the title alone.
    Rect_t area = {
        .x = 180,
        .y = 200,
        .width = 620,
        .height = 250,
    };
    epd_clear_area(area);

    int32_t cursor_x = 200;
    int32_t cursor_y = 270;
    writeln((GFXfont *)&FiraSans, line1, &cursor_x, &cursor_y, NULL);
    cursor_x = 200;
    cursor_y = 340;
    writeln((GFXfont *)&FiraSans, line2, &cursor_x, &cursor_y, NULL);
    cursor_x = 200;
    cursor_y = 410;
    writeln((GFXfont *)&FiraSans, line3, &cursor_x, &cursor_y, NULL);

    epd_poweroff();
    delay(SAMPLE_INTERVAL_MS);
}
