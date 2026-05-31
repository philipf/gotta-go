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

void sleepFor(CycleResult outcome, SleepHeader sleep, uint32_t awakeMs, uint32_t cycle) {
    const SleepDecision d = chooseSleep(sleep);

    Serial.printf("Cycle #%lu: outcome=%s, awake %lu ms, sleeping %lu s (%s)\n",
                  (unsigned long)cycle, cycleResultStr(outcome),
                  (unsigned long)awakeMs, (unsigned long)d.seconds, d.source);
    Serial.flush();  // drain the USB CDC FIFO before the peripheral powers down

    esp_sleep_enable_timer_wakeup((uint64_t)d.seconds * 1000000ULL);
    esp_deep_sleep_start();  // never returns
}
