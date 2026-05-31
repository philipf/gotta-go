# ADR-0012: Radiator host-native unit tests — CMake + doctest alongside arduino-cli

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — **radiator**, **panel**, **problem document**.
- **Related:** [ADR-0006](0006-radiator-firmware-toolchain.md) (the device toolchain this sits beside, and whose reversal triggers this addresses), [ADR-0005](0005-worker-source-architecture.md) (the Worker's `/tdd` rhythm this brings to the firmware), [ADR-0011](0011-error-contract-problem-details.md) (the error contract the first tests characterise), [#63](https://github.com/philipf/gotta-go/issues/63) (the refactor that produced the first testable module).

## Context

The firmware was one untestable translation unit. GH #63 began splitting it into modules; the first split (the `problem` module — `parseProblem` + the pure `resolveErrorScreen` + the neutral `renderErrorScreen`) produced logic that is pure and portable, but had no way to be exercised except by flashing the board and forcing a Worker error by hand. That on-panel verification is irreplaceable for the draw path, but it's slow, manual, and can't gate a commit — so the fallback rules (empty title → generic heading, empty detail → HTTP-status line, `upstream_detail` gated on the verbose flag) had no regression net.

ADR-0006 pinned the **device** toolchain (arduino-cli + esp32 core 2.0.15 + LilyGo-EPD47) and listed, among its reversal triggers, *"CI needs to build the firmware … PlatformIO has more mature CI tooling"* and *"the firmware grows past a single-sketch project structure."* Both are now partially true: #63 introduced multiple translation units, and we want a regression net. The question this ADR answers is **which** answer to give that trigger — adopt PlatformIO wholesale, or add a narrow host-native test build beside arduino-cli.

The key enabler is that the valuable logic doesn't need the hardware. `parseProblem` depends only on ArduinoJson (portable C++); `resolveErrorScreen` depends on nothing but `<string.h>`. The panel and the Wi-Fi/HTTP stack are the only genuinely un-hostable surfaces, and the #63 architecture deliberately keeps them behind seams (neutral `renderErrorScreen`, primitive-in/value-out resolve functions).

## Decision

**Add a host-native unit-test build under `src/radiator/test/` — CMake + [doctest] — that compiles the pure firmware modules with the host g++ and stubs the Arduino/EPD surface. arduino-cli stays the sole device toolchain (ADR-0006 unchanged); this is an *addition*, not a reversal.**

### Shape

- **doctest**, single header, vendored at `test/doctest.h` (v2.4.11, MIT). Header-only keeps the test build self-contained and offline — no package step, matching the spirit of the vendored `src/uzlib/`.
- **The module under test is compiled from its real `.cpp`** (e.g. `../problem.cpp`), never a copy. Tests exercise shipping code.
- **Only the un-hostable surface is stubbed**, in `test/stubs/`: `Arduino.h` (a no-op `Serial`), `epd_driver.h` (no-op draw calls; text measurement returns a deterministic width), `firasans.h` (one inline `FiraSans`). The pure targets under test touch none of it; the stubs exist only so the module links.
- **ArduinoJson is reused from the device build's copy** (`~/Arduino/libraries/ArduinoJson/src`, overridable via `-DARDUINOJSON_DIR`) — one source of truth, no second vendored tree that could drift from what flashes.

### Division of labour with on-panel verification

| Concern | Verified by |
|---|---|
| Pure parse / resolve / decode logic (`parseProblem`, `resolveErrorScreen`, future sleep-header parse, BMP field decode) | Host tests, every commit |
| Anything that draws to the **panel** or drives Wi-Fi/HTTP/TLS | On-panel re-verify (the #63 guardrail) — unchanged |

Host tests do **not** replace the on-panel check for the happy path or the error-screen *rendering*; they cover the logic the panel check can't assert on cheaply.

### Why not PlatformIO

PlatformIO's `native` env + `pio test` is the heavier answer to ADR-0006's trigger: it would replace arduino-cli, forcing a re-verify of the FQBN/board-option matrix (the four load-bearing keys in ADR-0006 §Quirks) through a new build system — a cost justified only if we also wanted PlatformIO's CI/multi-board story now. We don't. A ~40-line `CMakeLists.txt` that builds pure logic against g++ buys the regression net without touching the proven device path. Revisit PlatformIO if/when a second board variant or a full firmware CI build lands (still ADR-0006's call).

## Consequences

### Positive

- **The `/tdd` rhythm reaches the firmware.** New module logic from the remaining #63 splits (`net` / `frame` / `sleep`) is written test-first; `test/README.md` documents the add-a-module pattern.
- **Fast regression net for pure logic** — millisecond runs, no board, gateable in CI later with just `cmake --build && ctest`.
- **arduino-cli untouched** — zero risk to the flashing path; ADR-0006 stands.
- **A testability pressure that improves the design** — e.g. `parseSleepSeconds(HTTPClient&)` must grow a pure `parse(const char*)` core to be hostable, which is the better seam anyway.

### Negative / follow-ups

- **A second build system to keep alive.** Mitigated by its size and by reusing the device's ArduinoJson rather than vendoring a parallel copy.
- **Stubs can drift from the real library APIs.** The stubs cover only the symbols the modules call; a signature change in LilyGo-EPD47 surfaces at the *device* compile, not here. Acceptable — the stubs exist to link pure logic, not to emulate the panel.
- **Not yet wired into CI.** The harness runs locally; standing up CI (and deciding host-test vs device-compile gating) is deferred — same posture ADR-0006 took.
- **doctest is vendored**, so its version is pinned until manually bumped. Fine for a single-header dep.

## Verification

- `cmake -S test -B test/build && cmake --build test/build && ctest --test-dir test/build` is green on a fresh checkout (10 cases / 26 assertions for the `problem` module as of this ADR).
- The device build (`arduino-cli compile .`) is unaffected.

## References

- GH #63 — *Refactor `radiator.ino` into modules* (produced the first testable module)
- [ADR-0006](0006-radiator-firmware-toolchain.md) — device toolchain + the reversal triggers this answers
- [doctest] — <https://github.com/doctest/doctest>

[doctest]: https://github.com/doctest/doctest
