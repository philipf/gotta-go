# Vendored: uzlib (inflate-only)

- **Upstream:** <https://github.com/pfalcon/uzlib>
- **Pinned commit:** `6d60d65`
- **Copied:** 2026-05-29 (commit `79d4b8c`)
- **Licence:** zlib licence (see header in `uzlib.h`)
- **Rationale:** [ADR-0008](../../../../docs/adr/0008-radiator-gzip-decompression.md). The Arduino library registry does not ship `uzlib`, so the ADR's "Negative consequences" fallback applies: vendor the source under the radiator sketch.

## Files vendored

Inflate subset only — the radiator never compresses, so the deflate sources from upstream are intentionally omitted.

| File | Origin | Purpose |
| --- | --- | --- |
| `tinflate.c` | upstream `src/tinflate.c` | Core inflate state machine |
| `tinfgzip.c` | upstream `src/tinfgzip.c` | Gzip-wrapper parse on top of inflate |
| `crc32.c` | upstream `src/crc32.c` | CRC32 for the gzip trailer |
| `adler32.c` | upstream `src/adler32.c` | Adler32 (pulled in by uzlib.h; unused on the gzip path but cheap) |
| `uzlib.h` | upstream `src/uzlib.h` | Public API surface |
| `tinf.h` | upstream `src/tinf.h` | Legacy compatibility header |
| `tinf_compat.h` | upstream `src/tinf_compat.h` | Legacy compatibility shims |
| `defl_static.h` | upstream `src/defl_static.h` | Static Huffman tables (header pulled by tinflate.c) |
| `uzlib_conf.h` | upstream `src/uzlib_conf.h` | Build-time switches |

## Local modifications

| File | Change | Reason |
| --- | --- | --- |
| `uzlib_conf.h` | `UZLIB_CONF_PARANOID_CHECKS` default flipped from `0` → `1` | Firmware runs TLS with `setInsecure()`, so the gzip body is attacker-influenceable. See §Security review below. |

All other files are byte-for-byte copies from upstream `6d60d65`.

## How to refresh

```bash
git clone https://github.com/pfalcon/uzlib /tmp/uzlib
cd /tmp/uzlib && git checkout <new-commit>
cp src/{tinflate.c,tinfgzip.c,crc32.c,adler32.c,uzlib.h,tinf.h,tinf_compat.h,defl_static.h,uzlib_conf.h} \
   <repo>/src/radiator/src/uzlib/
```

Then bump the **Pinned commit** and **Copied** lines above, rebuild with `arduino-cli compile .`, and re-run the GH #4 wake-cycle smoke test (serial log should still show `inflate: ok 64862 bytes in N ms`).

## Security review

Conducted 2026-05-29 against the vendored tree at upstream `6d60d65`.

### Threat model

The radiator fetches a gzipped BMP over HTTPS from the Worker. `WiFiClientSecure::setInsecure()` is in effect (see `radiator.ino` + the README's *What this firmware does NOT do* list), so an attacker on the local Wi-Fi can MITM the connection and supply an arbitrary gzip body. uzlib's inflate path is therefore on an attacker-influenceable input edge. Failure of the inflate or downstream BMP-header parse leaves the panel untouched per [ADR-0003](../../../../docs/adr/0003-radiator-worker-contract.md) row 2 — that's the second line of defence, not the first.

### Static review (clean)

Greps over `*.c`/`*.h` for syscalls, network, IPC, `exec*`, `fopen`, `socket`, `dlopen`, inline `asm`, `malloc`/`free`, and `strcpy`/`strcat`/`sprintf`/`gets` came back empty. The only suspect libc call is `memcpy` at `tinflate.c:488`, gated behind `UZLIB_CONF_USE_MEMCPY` (default `0` in `uzlib_conf.h:29`). All license headers match upstream byte-for-byte. No malware indicators.

Existing in-tree bounds checks that hold under crafted input:

- `tinflate.c:287` — Huffman tree depth cap (`TINF_DATA_ERROR` on overrun).
- `tinflate.c:432` — length-code symbol bounded `< 29`.
- `tinflate.c:440` — distance-code symbol bounded `< 30`.
- `tinflate.c:468` — LZ offset can't point before `dest_start`.
- `tinflate.c:623` — outer loop respects `dest_limit`, so inflate writes can't run past the destination buffer.

### Public-database check

- **NVD / cve.org / MITRE** — no CVE entries match `uzlib`, `tinf`, or `tinflate` as of 2026-05-29.
- The well-known inflate CVE in this space ([CVE-2022-37434](https://nvd.nist.gov/vuln/detail/CVE-2022-37434)) is against zlib's `inflateGetHeader`, which uzlib does not implement.

### Open upstream issues

Checked at <https://github.com/pfalcon/uzlib/issues> on 2026-05-29.

| # | Title | Affects us? | Notes |
| --- | --- | --- | --- |
| #50 | `UZLIB_CONF_USE_MEMCPY` option bug — `memcpy` on overlapping LZ regions is UB | **No** | Flag is `0` in our `uzlib_conf.h` (default). |
| #49 | Multi-call `uzlib_uncompress` with small buffers returns `TINF_DATA_ERROR` early | **No** | We do whole-body one-shot inflate into a PSRAM buffer sized for the full 64,862 B BMP. |
| #51 | Feature request: single-file header | **No** | Not security-relevant. |
| #41 | Memory pointer ownership / API ergonomics | **No** | Not security-relevant. |

### Hardening applied

`UZLIB_CONF_PARANOID_CHECKS` flipped from upstream default `0` to `1` in our `uzlib_conf.h`. Enables:

- `tinflate.c:297–301` — bounds-check `sum` before indexing `t->trans[sum]` (prevents OOB read of the symbol-translation table on a malformed dynamic-tree header).
- `tinflate.c:388–393` — refuse a dynamic tree that lacks an end-of-block (`256`) symbol.

Cost is a handful of branches per symbol decode on a ~525 B body once per wake — negligible against the TLS handshake time the wake-cycle already pays.

### Residual risk

Not addressed by this review:

- **TLS pinning.** `client.setInsecure()` is the dominant attack vector; this review hardens the *inflate* path but does not close the MITM path. Tracked in the GH #4 plan's *Open items not blocking #4* list.
- **uzlib pinned by source vendor, not by tagged release.** A future refresh has to be re-reviewed; the `## How to refresh` block above is the entry point.

## Reversal triggers (from ADR-0008)

- Upstream API breaks — diff against `6d60d65` and decide whether to follow or fork.
- Arduino registry starts shipping `uzlib` — delete this directory, add the pin to `sketch.yaml`, and rely on `arduino-cli lib install`.
- ESP32 Arduino core gains transparent gzip in `HTTPClient` — drop uzlib entirely.
