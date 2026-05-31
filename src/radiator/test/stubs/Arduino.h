// Host-native stub of <Arduino.h> — just enough of the Arduino runtime for the
// pure firmware modules to compile and run off-device under the test harness.
// The device build uses the real core (ADR-0006); this is never flashed.
#pragma once

#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstring>

// Minimal Serial: firmware logging is a no-op host-side. Tests assert on
// behaviour and return values, never on serial output.
struct HostSerial {
    template <typename... Args> void printf(const char *, Args...) {}
    void println(const char * = "") {}
    void print(const char *) {}
    void flush() {}
    void begin(unsigned long) {}
};
inline HostSerial Serial;
