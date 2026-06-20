/**
 * sleep.cpp — the device half of the sleep module: log the cycle outcome, arm
 * the deep-sleep timer, and enter deep sleep. The pure policy (chooseSleep,
 * cycleResultStr) lives in sleep.h and is host-tested; this file is the ESP-only
 * orchestration, so — like net.cpp — it is excluded from the host test build.
 *
 * Extracted from radiator.ino per GH #63 (the #5 sleep seam).
 */
#include "sleep.h"

#include <Arduino.h>
#include <esp_sleep.h>

#include "epd_driver.h"  // epd_poweroff_all — cut the whole panel rail before sleep (GH #80)

void sleepFor(CycleResult outcome, SleepHeader sleep, uint32_t awakeMs, uint32_t cycle) {
    const SleepDecision d = chooseSleep(sleep);

    Serial.printf("Cycle #%lu: outcome=%s, awake %lu ms, sleeping %lu s (%s)\n",
                  (unsigned long)cycle, cycleResultStr(outcome), (unsigned long)awakeMs,
                  (unsigned long)d.seconds, d.source);
    Serial.flush();  // drain the USB CDC FIFO before the peripheral powers down

    // Deep-sleep teardown (GH #80). The frame/battery paths call epd_poweroff(),
    // which only gates the display *driver* — the LilyGo T5's panel boost
    // converter and front-light LED sit on the PWM_EN rail, which stays
    // energized through deep sleep and bleeds milliamps. epd_poweroff_all() drops
    // that whole rail; Serial.end() releases the USB CDC so it can't hold the
    // peripheral awake. This mirrors the LilyGo demo's known-good ~388 uA sleep
    // sequence — vs the ~18-25 mA average measured without it (sub-3-day runtime).
    // Safe on every arm: epd_init() runs at the top of setup() before any
    // sleepFor() call, so the driver is always initialized when we reach here.
    epd_poweroff_all();
    Serial.end();

    esp_sleep_enable_timer_wakeup((uint64_t)d.seconds * 1000000ULL);
    esp_deep_sleep_start();  // never returns
}
