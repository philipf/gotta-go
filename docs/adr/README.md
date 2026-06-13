# Architecture Decision Records

An ADR records a **decision and its why** — a contested choice between alternatives that a future reader would otherwise re-litigate. It is the *rationale*; the authoritative *what* lives elsewhere (the OpenAPI spec, the code, the glossary).

Precedence when sources disagree: **code wins > [`../worker-architecture.md`](../worker-architecture.md) > ADRs.**

## Index

| ADR | Decision |
|---|---|
| [0001](0001-frame-transport-compression.md) | Gzip the frame body on the wire (Worker side) — 5–12× less Wi-Fi radio time per wake |
| [0003](0003-radiator-worker-contract.md) | The radiator ↔ Worker HTTP contract — endpoint, header auth/identity, sleep authority, firmware response handling |
| [0004](0004-diagnostics-view-content-negotiation.md) | Serve the diagnostics view via `Accept`-based content negotiation on `/v1/frame` |
| [0005](0005-worker-source-architecture.md) | Worker source layout — feature folders over a gateway tier (the tier map; the guide is the how-to) |
| [0006](0006-radiator-firmware-toolchain.md) | Firmware toolchain — `arduino-cli` + ESP32 Arduino core 2.0.15 + LilyGo-EPD47 |
| [0008](0008-radiator-gzip-decompression.md) | Firmware gzip decoder — `uzlib` (the firmware half of 0001) |
| [0009](0009-display-typeface-dejavu-sans-bold.md) | Display typeface — DejaVu Sans Bold replaces Press Start 2P |
| [0010](0010-no-metlink-cache-layer.md) | No caching layer for the Metlink gateway |
| [0011](0011-error-contract-problem-details.md) | Error contract — RFC 9457 `problem+json` + a firmware error screen |
| [0012](0012-radiator-host-native-tests.md) | Host-native firmware unit tests — CMake + doctest beside arduino-cli |
| [0013](0013-conditional-frame-requests.md) | Conditional frame requests — `ETag` / `304` unchanged-frame skip |
| [0015](0015-profile-phase-active-days.md) | Profile-phase active days are a weekday filter on the active match |

Numbers are not reused. Gaps (0002, 0007, 0014, 0016, 0017) are ADRs that were **deleted** because they turned out not to be decisions — reference material or coding conventions wearing the template (see below). Git keeps their history; no redirect stubs.

## What is *not* an ADR

- **Reference material** (field maps, sample payloads, API-contract tables, verified IDs) → [`../reference/`](../reference/) or next to the code (a gateway `wire-types.ts` / `fixtures.ts`, a firmware README). *Example: the old ADR-0002 became [`../reference/metlink-stop-predictions.md`](../reference/metlink-stop-predictions.md).*
- **A runbook** (toolchain bring-up steps, board quirks) → a README next to the code.
- **A coding convention** (file-header style, naming) → [`../worker-architecture.md`](../worker-architecture.md) § Conventions. Convention ADRs are **hard-deleted**, not stubbed.

## Lean ADR style

[ADR-0010](0010-no-metlink-cache-layer.md) is the reference example. New ADRs follow it:

- **Omit `## Verification`** (curl acceptance tests → issues / test files) and **`## Glossary impact`** (a point-in-time migration checklist that goes stale the moment it's applied; the glossary is canonical).
- Trim "why this preserves *Dumb Radiator, Smart Edge*" to a sentence.
- Keep the options table to the alternatives a reader would actually reconsider.
- Don't duplicate field-level wire detail from the OpenAPI — link to it and explain the *why*.
- When a later ADR amends this one, **state the current truth directly** and forward-reference the amending ADR for detail. Don't accumulate strike-through supersession narrative — git keeps the history.

### Template

```markdown
# ADR-NNNN: <short decision title>

- **Status:** Accepted
- **Date:** YYYY-MM-DD
- **Deciders:** <name>
- **Language reference:** [`../glossary.md`](../glossary.md) — every term used here is defined there.

## Context
<the forces and constraints; what's unresolved and why it must be decided now>

## Decision
<what was decided, stated plainly>

## Options considered
<only the alternatives a future reader would otherwise re-propose, and why each lost>

## Consequences
### Positive
### Negative / follow-ups

## References
```

When deleting an ADR, redirect **every** reference: grep both `ADR-00NN` *and* the filename across all file types (`.md`, `.ts/.tsx`, `.yaml`, `.yml`, `.cpp/.h/.ino`) — some references use the file path, not the `ADR-00NN` string.
