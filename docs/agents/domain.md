# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/glossary.md`** — the GottaGo ubiquitous language. Every domain term (radiator, frame, layout, profile phase, transit target, Leave In, Leave By, catchable service, marker, window, etc.) is defined there, with rejected synonyms listed explicitly. Treat the rejected-synonym list as a contract.
- **`docs/PRD/GottaGo PRD.md`** — the current product spec. Earlier versions in `docs/PRD/` are historical only.
- **`docs/UI/GottaGo - UI_UX Design Reference.md`** — screen scenarios and weight-band guidance for the `priority_split` layout.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Directory does not exist yet; it'll be created lazily when decisions get recorded.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## File structure

Single-context repo:

```
/
├── CLAUDE.md
├── docs/
│   ├── glossary.md             ← canonical ubiquitous language
│   ├── PRD/
│   ├── UI/
│   ├── adr/                    ← created lazily as decisions get recorded
│   └── agents/                 ← this directory
└── src/                        ← does not exist yet
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name, a config key, a code symbol, a commit message), use the canonical term as defined in `docs/glossary.md`. Don't drift to synonyms the glossary explicitly rejects — the "Don't say / Say instead" table in §10 is the contract.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it; the glossary lists open language questions in §11).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0005 — but worth reopening because…_
