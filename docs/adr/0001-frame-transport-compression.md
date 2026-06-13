# ADR-0001: Frame transport compression

- **Status:** Accepted
- **Date:** 2026-05-18
- **Deciders:** Philip Fourie
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.

## Context

The `to-bmp` PoC ([`../../poc/to-bmp/plan.md`](../../poc/to-bmp/plan.md)) confirmed that one rendered **frame** is exactly **64,862 bytes** of uncompressed 1-bit BMP1 at 960×540. The radiator fetches one frame per **wake cycle** — every 2–3 minutes during active commute phases, every 30 minutes in idle phases (PRD v0.4 §7 power management).

Two pressures push against the status quo of sending raw BMP bytes:

1. **Battery life.** The radiator runs on a 2000 mAh LiPo (PRD §4). **Wi-Fi radio time is the dominant per-wake power cost** — at typical home Wi-Fi rates, transferring 64 KB takes ~100–200 ms of radio-on time; transferring 8 KB takes ~12–25 ms. Over thousands of wake cycles per battery charge, the difference is material.
2. **Cloudflare egress.** Bytes-on-the-wire is also bytes-out-of-the-edge. Smaller frames are cheaper at scale.

The friction against compressing is the **"Dumb Radiator, Smart Edge"** architectural pattern from PRD §8: the radiator performs zero data processing, JSON parsing, schedule evaluation, or layout maths. Adding gzip decompression nudges the radiator slightly more capable. The question is whether that nudge breaches the contract.

**What the PRD says today:**

- §7: "the Worker **shall** … encode the final output as a flattened 1-bit monochrome BMP byte array at 960×540 via manual BMP byte construction, optimised for direct native flushing by the LilyGO T5 panel." The word "optimised" is genuinely ambiguous — it could mean size-optimised (compression invited) or simplicity/latency-optimised (compression discouraged).
- §8: the request/response contract specifies `HTTP body = binary BMP` with no `Content-Encoding` field.
- [`../glossary.md`](../glossary.md): defines **frame** as a 960×540 1-bit BMP. Silent on wire encoding.

No prior decision exists. No firmware code exists yet. The Worker PoC ([`../../poc/worker/`](../../poc/worker/)) contains only template scaffolds. This is a clean-slate choice.

## Decision

**The Worker shall gzip-compress the frame body using the native Cloudflare Workers `CompressionStream('gzip')` API, set `Content-Encoding: gzip`, and keep `Content-Type: image/bmp`. The radiator shall send `Accept-Encoding: gzip` and decompress the response before flushing the resulting raw BMP bytes to the EPD panel.**

Gzip default compression level (6) is used; level 9 buys < 5% extra at noticeably higher Worker CPU cost.

## Options considered

| Option                            | Wire size (est.) | Radiator firmware cost                                                                                                                             | Verdict                                                                                      |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Uncompressed BMP** (status quo) | 64,862 B         | Trivial — flush bytes                                                                                                                              | **Rejected** — wastes battery; ~10× more radio-on time than necessary                        |
| **HTTP gzip**                     | ~5–13 KB         | Small — link zlib (already in ESP-IDF) or miniz (~10 KB); most HTTP libs handle `Content-Encoding: gzip` transparently                             | **Chosen**                                                                                   |
| **PNG (1-bit indexed)**           | ~5–13 KB         | Moderate — PNG decoder library (e.g. PNGdec), filter/chunk parsing, palette handling — ~10–15 KB more firmware than gzip for the same wire savings | Rejected — same payoff as gzip for more firmware code                                        |
| **Custom RLE**                    | ~3–8 KB          | Trivial decode                                                                                                                                     | Rejected — tight Worker↔firmware coupling, custom debugging burden, no off-the-shelf tooling |
| **Brotli**                        | ~4–10 KB         | Heavy — Brotli decoder is large (~50 KB+ code) and RAM-hungry on ESP32                                                                             | Rejected — marginal gains over gzip don't justify the firmware cost                          |

**This preserves "Dumb Radiator, Smart Edge."** That principle is about *semantic* simplicity — no layout, schedule, or transit-data interpretation. Decompressing a known-format byte stream is a *mechanical* operation, a smaller delta than the Wi-Fi, HTTPS, and EPD-flush stacks the firmware already runs. The Worker still owns 100% of the semantic work.

## Consequences

### Positive

- **Battery life.** Roughly 5–12× reduction in Wi-Fi radio-on time per wake cycle. Over a battery charge, this compounds.
- **Cloudflare egress cost.** Bytes-out drop by the same factor.
- **Transfer latency.** Smaller frames arrive faster, which marginally tightens the wake-fetch-flush-sleep loop.
- **Worker CPU is essentially free.** `CompressionStream('gzip')` is native to the Workers runtime; ~1–5 ms for a 64 KB buffer.

### Negative / follow-ups

- **Cloudflare auto-compression skips `image/*` MIME types.** Edge-side automatic compression is not a fallback — the Worker must call `CompressionStream` explicitly and set `Content-Encoding: gzip` itself. Easy to miss; called out here to prevent re-discovery.
- **Firmware must include a gzip decoder.** Either link the zlib bundled with ESP-IDF or use miniz (~10 KB code). Either is mature and well-trodden. Most ESP32 HTTP client libraries already handle `Content-Encoding: gzip` transparently when `Accept-Encoding: gzip` is sent on the request.
- **PRD wording needs updating.** §7 and §8 should be revised to mention `Content-Encoding: gzip` and the radiator's `Accept-Encoding` requirement. Defer to a v0.5 PRD bump after the Worker PoC empirically confirms the compression ratio.
- **Empirical measurement still required.** Estimated 5–13 KB compressed is based on the typical mostly-white EPD-style content. A 3-line gzip experiment in `poc/to-bmp/index.ts` will confirm the real numbers on both the production-like `input.svg` and the adversarial `pattern.bmp` checkerboard. Flagged in [`../../poc/to-bmp/hand-off-next-steps.md`](../../poc/to-bmp/hand-off-next-steps.md) as recommended pre-Worker measurement.
- **Brotli option not foreclosed forever.** If a future ESP32 platform ships a hardware Brotli decoder, revisit. Until then, gzip wins on firmware footprint.

## References

- [PRD v0.4](../PRD/GottaGo%20PRD%20v0.4.md) §7 (non-functional requirements — rendering pipeline, power management), §8 (architecture, request/response contract)
- [Glossary](../glossary.md) — `frame`, `wake cycle`, `sleep duration`, `radiator`
- [`poc/to-bmp/plan.md`](../../poc/to-bmp/plan.md) — BMP encoder design and verification
- [`poc/to-bmp/hand-off-next-steps.md`](../../poc/to-bmp/hand-off-next-steps.md) — implementation hand-off to the next PoC, including the recommended gzip-measurement experiment
- [Cloudflare Workers — `CompressionStream`](https://developers.cloudflare.com/workers/runtime-apis/streams/compressionstream/)
