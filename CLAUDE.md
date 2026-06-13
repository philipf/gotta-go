 See `docs/PRD/GottaGo PRD v0.4.md` for the product spec and `docs/glossary.md` for the ubiquitous language — every term used in conversation, config, code, and docs is defined there.

## Agent skills
Issues live in the `philipf/gotta-go` GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels
Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context layout. The canonical vocabulary lives in `docs/glossary.md`. See `docs/agents/domain.md`.

### Worker architecture
**`docs/worker-architecture.md` is the canonical guide** to how Worker code is built — pillars (Deep Modules, Feature Folders, REPR), the gateway/feature/endpoint patterns, conventions, heuristics, anti-patterns, and the reasons behind them. **Code wins; the guide follows.** Read it first for principles, then the code for a working example. Where code *lives* (the tier map) is ADR-0005.

## Worker tech stack to use
- TypeScript
- pnpm not npm
- mise to manage developer tools 
