# Radiator host-native tests

Fast, off-device unit tests for the firmware's **pure** logic. The panel and the
Wi-Fi/HTTP stack can't run in CI, so we compile the portable modules against the
host toolchain (g++), swap the Arduino/EPD surface for the stubs in `stubs/`, and
run them with [doctest](https://github.com/doctest/doctest). The device build
(arduino-cli, ADR-0006) is unchanged — see [ADR-0012](../../../docs/adr/0012-radiator-host-native-tests.md).

## Run

```sh
cd src/radiator/test
cmake -S . -B build && cmake --build build
ctest --test-dir build --output-on-failure    # or: ./build/radiator_tests
```

Requires `cmake`, a C++17 `g++`, and the same `ArduinoJson` the device build uses
(`arduino-cli lib install ArduinoJson@7.4.3`). If your Arduino libraries live
elsewhere, pass `-DARDUINOJSON_DIR=/path/to/ArduinoJson/src`.

## Layout

| Path | Role |
| --- | --- |
| `test_problem.cpp` | Tests for the `problem` module (`parseProblem`, `resolveErrorScreen`). |
| `stubs/` | Host stand-ins for `Arduino.h`, `epd_driver.h`, `firasans.h` — no-op draw, deterministic text measurement. |
| `doctest.h` | Vendored doctest v2.4.11 (single header, MIT). |
| `CMakeLists.txt` | Builds the module-under-test from its real source + the stubs. |

## Adding a module to the harness

This is the pattern for the `net` / `frame` / `sleep` splits to come:

1. Keep the testable logic **pure** (primitive in, value out) — no `HTTPClient&`,
   no panel calls. That's the seam the test drives.
2. Add the module's real `.cpp` to the `add_executable` list in `CMakeLists.txt`.
3. Add any new Arduino/library symbols it references to `stubs/`.
4. Write `test_<module>.cpp` **test-first** for new behaviour (red → green).

Only `test_problem.cpp` uses `DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN`; a second test
file should `#include "doctest.h"` without that define (one `main()` per binary).
