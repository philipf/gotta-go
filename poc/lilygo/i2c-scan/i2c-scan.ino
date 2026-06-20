/**
 * GottaGo — LilyGO T5 4.7" EPD I2C-scan PoC
 *
 * Isolated spike answering exactly one question, non-destructively: is a GT911
 * capacitive touch controller present and powered on this board? The radiator's
 * deep-sleep current still has a residual ~3.5 mA after the panel-rail fix (PR
 * #122, GH #80); the leading suspect is an un-slept GT911. But `office-f5` was
 * bought as the non-touch SKU, which shares the touch SKU's PCB silk/layout, so
 * presence is unresolved by eye. One serial line from this scan settles it.
 *
 * Hardware facts (from LilyGo-EPD47 src/utilities.h, examples/demo + touch):
 *   - The T5-4.7 S3 shares ONE I2C bus between the PCF8563 RTC and the GT911
 *     touch. The bus pins are the library's board macros, not guesses:
 *     S3 → BOARD_SDA = GPIO 18, BOARD_SCL = GPIO 17.
 *   - The RTC ACKs at 0x51; the GT911 ACKs at 0x5D or 0x14.
 *   - The I2C bus (RTC + touch + pull-ups) is fed by the switched peripheral
 *     rail that epd_poweron() enables. With the rail off NOTHING ACKs — not even
 *     the RTC — so the demo (demo.ino) powers the panel BEFORE probing the bus.
 *     epd_poweron() drives only the EPD config register + STH/STV; it does NOT
 *     touch TOUCH_INT/RST, so it powers the bus without disturbing touch GPIOs.
 *
 * SAFETY — this is the whole reason a scan was chosen over adding touch code:
 * the scanner is READ/NAK ONLY on I2C. It never drives the GT911 RST/INT GPIOs,
 * never issues a device write, never wakes touch. On the non-touch board those
 * touch GPIOs may be unconnected or repurposed near EPD signals; an address
 * probe that only ACK-checks cannot disturb them, where a full touch init could.
 * (epd_init/epd_poweron are called solely to power the I2C rail — see above.)
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
#include <Wire.h>
#include "epd_driver.h"  // LilyGo-EPD47: epd_init/epd_poweron — powers the I2C rail
#include "utilities.h"   // LilyGo-EPD47: canonical BOARD_SDA / BOARD_SCL per target

// Re-scan cadence. Slow enough to read comfortably over serial.
static const uint32_t SCAN_INTERVAL_MS = 5000;

void setup() {
    Serial.begin(115200);
    delay(1000);  // beat for USB-CDC to re-attach after reset (matches battery-level PoC)
    Serial.println("GottaGo I2C-scan PoC");
    Serial.printf("I2C bus pins (LilyGo-EPD47 utilities.h): SDA=GPIO%d, SCL=GPIO%d\n",
                  BOARD_SDA, BOARD_SCL);

    // The I2C bus (RTC + touch + pull-ups) hangs off the switched peripheral
    // rail. Power it before probing or NOTHING ACKs — not even the RTC. This is
    // rail power only; we never drive TOUCH_INT/RST or touch any GT911 register.
    epd_init();
    epd_poweron();
    delay(10);  // let the rail settle before the first transaction

    Wire.begin(BOARD_SDA, BOARD_SCL);
}

// Annotate an ACKing address against the known T5-4.7 bus legend.
static const char *legendFor(uint8_t addr) {
    switch (addr) {
        case 0x51: return "PCF8563 RTC (expected) -> bus/pins confirmed";
        case 0x5D: return "GT911 touch -> likely ~3 mA culprit; sleeping it in firmware is worthwhile";
        case 0x14: return "GT911 touch -> likely ~3 mA culprit; sleeping it in firmware is worthwhile";
        default:   return "unknown device";
    }
}

void loop() {
    Serial.println("Scanning 0x01-0x7F ...");

    int found = 0;
    for (uint8_t addr = 0x01; addr <= 0x7F; addr++) {
        // Read/NAK only: begin + end transmission ACK-probes the address
        // without writing any register or toggling any GPIO.
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf("  0x%02X ACK -> %s\n", addr, legendFor(addr));
            found++;
        }
    }

    if (found == 0) {
        Serial.println("  no devices found -> rail not up or wrong pins; the RTC at 0x51 is the canary, expect it before trusting any result");
    }
    Serial.println();

    delay(SCAN_INTERVAL_MS);
}
