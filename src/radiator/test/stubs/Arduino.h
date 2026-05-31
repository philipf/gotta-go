// Host-native stub of <Arduino.h> — just enough of the Arduino runtime for the
// pure firmware modules to compile and run off-device under the test harness.
// The device build uses the real core (ADR-0006); this is never flashed.
#pragma once

#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <cstdlib>

// ESP heap-caps allocator → plain malloc host-side; the capability flag is moot.
#define MALLOC_CAP_SPIRAM 0
inline void *heap_caps_malloc(size_t size, uint32_t) { return std::malloc(size); }

// millis(): firmware timing reads; a fixed value keeps host runs deterministic.
inline unsigned long millis() { return 0; }

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
