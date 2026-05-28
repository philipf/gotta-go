 See `docs/PRD/GottaGo PRD v0.4.md` for the product spec and `docs/glossary.md` for the ubiquitous language — every term used in conversation, config, code, and docs is defined there.

## Agent skills
Issues live in the `philipf/gotta-go` GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels
Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context layout. The canonical vocabulary lives in `docs/glossary.md`. See `docs/agents/domain.md`.

### Worker architecture
Pillars (Deep Modules, Feature Folders, REPR), heuristics, anti-patterns. See `docs/agents/worker-architecture.md`; underlying decisions in ADR-0005 and ADR-0007.

## Worker tech stack to use
- TypeScript
- pnpm not npm
- mise to manage developer tools 
