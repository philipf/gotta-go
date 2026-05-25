/**
 * GottaGo — LilyGO T5 4.7" EPD hello world
 *
 * Smallest sketch that proves the toolchain, the panel, and the bundled
 * FiraSans font are all alive. Renders one line of text at boot, then idles.
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

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("GottaGo hello world");

    epd_init();

    epd_poweron();
    epd_clear();

    int32_t cursor_x = 200;
    int32_t cursor_y = 280;
    writeln((GFXfont *)&FiraSans, "Hello GottaGo", &cursor_x, &cursor_y, NULL);

    epd_poweroff();
}

void loop() {
    // Render once at boot, then idle.
    delay(1000);
}
