# GottaGo

> You're half-awake, crossing the kitchen at 7am. The bus leaves in four minutes. **Do you know that yet?**

GottaGo is a network of ambient e-ink transit radiators that answer the only question that matters in the morning rush: **when do I need to leave the house?**

Standard transit apps tell you when the bus *arrives*. That forces you to subtract your walk time, subtract how long you've been standing there, and decide whether to move — all before your first coffee. GottaGo removes that maths entirely. It tells you **LEAVE IN 7 MIN** and nothing else, glanceable from across the room, with zero taps, zero unlocking, zero squinting.

---

## What it looks like

### Normal morning — bus and train, side by side

![Main screen — dual commute, bus and train](docs/UI/GottaGo_Main.jpeg)

The left column tracks the bus. The right tracks the train. The hero number is **LEAVE IN** — not arrival time. The diamond marker shows exactly how much runway you have: hard right means leave now.

### When things go sideways

![Cancelled and delayed service states](docs/UI/GottaGo_CancelAndDelayed.jpeg)

A cancellation strikes through the dead service in place so the change is explained, not silently replaced. A delay shifts the marker left and updates the countdown to reflect the new timing — the display tracks reality, not a plan. The unaffected column stays untouched, so the contrast itself tells you which side has the problem.

---

## How it works

The architecture follows a single principle: **Dumb Radiator, Smart Edge**.

Each radiator — a 4.7" e-ink panel running on a LiPo battery, flush-mounted on a fridge or bedside surface — does exactly one thing: wake up, fetch a frame from the cloud, flush the raw pixels to the screen, and go back to sleep for 2–3 minutes.

All the work happens at the edge:

- A **Cloudflare Worker** (TypeScript) determines the active profile phase from server time, queries the Metlink real-time API, computes leave countdowns with walk time and comfort buffers, renders the full layout using [Satori](https://github.com/vercel/satori) and the Press Start 2P pixel font, and encodes the result as a gzip-compressed 1-bit 960×540 BMP.
- The radiator receives the compressed frame, decompresses it, and flushes the raw byte array directly to the EPD panel buffer — no JSON parsing, no schedule logic, no maths.
- A **Cloudflare KV** cache absorbs burst fetches from multiple radiators, and protects the upstream Metlink rate limit.

When Wi-Fi fails or the Worker is unreachable, the panel holds its last good frame indefinitely — e-ink consumes zero power to maintain an image.

### Hardware

Each radiator is built from three components (~$83 NZD total):

![LilyGO T5 4.7" e-paper display with ESP32-S3](docs/UI/lilygo-t5-47-device.jpg)

| Component | Part |
| --- | --- |
| Panel & board | [LilyGO T5 4.7" e-paper with ESP32-S3](https://github.com/Xinyuan-LilyGO/LilyGo-EPD47) |
| Power | 2000 mAh LiPo battery |
| Enclosure | Custom 3D-printed chassis with rear neodymium magnet slots |

The panel renders at native **960×540, 1-bit monochrome**, landscape. No backlight, no glow, no notification sounds. It blends into the room.

---

## Documentation

| Document | Description |
| --- | --- |
| [PRD v0.4](docs/PRD/GottaGo%20PRD%20v0.4.md) | Full product requirements, screen layout spec, functional & non-functional requirements |
| [UI/UX Design Reference](docs/UI/Home%20Transit%20Radiator%20%E2%80%94%20UI_UX%20Design%20Reference.md) | Screen scenarios, design rationale, do/don't build guidance |
| [OpenAPI 3.1 spec](docs/api/openapi.yaml) | Authoritative radiator ↔ Worker wire contract |
| [Glossary](docs/glossary.md) | Ubiquitous language — every term used in conversation, config, code, and docs |
| [Worker Architecture](docs/worker-architecture.md) | Canonical guide to how Worker code is built — pillars, gateway/feature/endpoint patterns, conventions, and the reasoning behind them |
| [Architecture Decision Records](docs/adr/README.md) | The *why* behind contested choices — indexed, with the lean-ADR style for new records |
| [Reference](docs/reference/) | External-contract detail too granular for an ADR — e.g. [Metlink stop predictions](docs/reference/metlink-stop-predictions.md) (field maps, sample payloads, verified stop IDs) |

---

## Built with an AI-assisted workflow

This project is developed using an AI-assisted engineering workflow powered by [Claude Code](https://claude.ai/code). Design decisions are captured as ADRs, the domain language is formalised in a living glossary, and the implementation is driven by vertical slices from the PRD — all in close collaboration with an AI agent.
