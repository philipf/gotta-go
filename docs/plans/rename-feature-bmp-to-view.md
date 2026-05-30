# Rename feature `bmp.tsx` → `view.tsx`

> Status: 📋 ready to execute. Small, self-contained refactor from the ADR-0007 code review.
> Scope: `src/worker/features/minimal_clock/` and `src/worker/features/priority_split/` only.
> Estimated effort: ~10 min. No behaviour change — pure rename + comment fixes.

## Why

Each feature folder had a `bmp.tsx`. The name is wrong on two counts (ADR-0007
§"Module-named public file" — name a file after *what it does*):

1. **Inaccurate.** The file owns the `layout()` JSX (the actual visual design)
   and exports **both** `renderSvg` (the ADR-0004 diagnostics SVG path) *and*
   `renderBmp`. "bmp" hides the layout and the SVG path.
2. **Collides with `shared/bmp.ts`**, which is the real thing called bmp — the
   low-level 1-bit BMP byte encoder (`rgbaTo1BitBmp`). Editor tabs read
   `bmp.tsx`, `bmp.tsx`, `bmp.ts` for three different jobs.

`view.tsx` pairs cleanly with the existing `viewmodel.ts` (view ← viewmodel),
is accurate, and collides with nothing.

**Do NOT touch `src/worker/shared/bmp.ts`** — that is the canonical 1-bit BMP
encoder and keeps its name.

## Preconditions

- Clean working tree on `main` (or a fresh feature branch off it).
  If a previous attempt left changes, reset first:
  `git checkout -- src/worker/features && git clean -fd src/worker/features`
- `cd src/worker` for the pnpm commands below (worker package root).

## Steps

### 1. Rename both files (preserves history)

```bash
cd <repo-root>
git mv src/worker/features/minimal_clock/bmp.tsx  src/worker/features/minimal_clock/view.tsx
git mv src/worker/features/priority_split/bmp.tsx src/worker/features/priority_split/view.tsx
```

### 2. Update the two importers

`src/worker/features/minimal_clock/service.ts` and
`src/worker/features/priority_split/service.ts` each have:

```ts
import { renderBmp, renderSvg } from './bmp';
```

Change `'./bmp'` → `'./view'` in both.

### 3. Fix the stale prose reference

`src/worker/features/priority_split/service-name.ts` (header comment):

```
// ... Pure string logic, kept out of bmp.tsx so it can be unit-tested
```
→ `kept out of view.tsx`

### 4. Fix the file-header comments (they wrongly say "BMP renderer")

`src/worker/features/minimal_clock/view.tsx` — replace the 2-line header:

```ts
// BMP renderer for the minimal_clock layout. Lays out time + date with
// React/JSX → Satori → resvg → 1-bit BMP, using DejaVu Sans Bold (ADR-0009).
```
with:
```ts
// View renderer for the minimal_clock layout. Lays out time + date as React/JSX
// and renders it via Satori → resvg, exposing both the intermediate SVG (ADR-0004
// diagnostics) and the rasterised 1-bit BMP, using DejaVu Sans Bold (ADR-0009).
```

`src/worker/features/priority_split/view.tsx` — first header line:

```ts
// BMP renderer for the priority_split layout. Lays out the global header
```
→ `// View renderer for the priority_split layout. Lays out the global header`

and the last header line:
```ts
// React/JSX → Satori → resvg → 1-bit BMP, DejaVu Sans Bold throughout (ADR-0009).
```
→
```ts
// React/JSX → Satori → resvg, exposing the intermediate SVG (ADR-0004) and the
// rasterised 1-bit BMP, DejaVu Sans Bold throughout (ADR-0009).
```

> Steps 2–4 are also achievable non-interactively:
> ```bash
> cd src/worker
> perl -i -pe "s{from './bmp'}{from './view'}" \
>   features/minimal_clock/service.ts features/priority_split/service.ts
> perl -i -pe 's/kept out of bmp\.tsx/kept out of view.tsx/' \
>   features/priority_split/service-name.ts
> perl -i -pe 's/BMP renderer for the (minimal_clock|priority_split)/View renderer for the $1/' \
>   features/minimal_clock/view.tsx features/priority_split/view.tsx
> ```
> (The perl variant only flips the "BMP renderer" titles; the fuller header
> rewrites in step 4 are optional polish — do them by hand if desired.)

## Verification (must pass)

```bash
cd src/worker
grep -rn "from './bmp'" features/        # expect: no matches
ls features/*/bmp.tsx 2>/dev/null         # expect: nothing
pnpm tsc --noEmit                         # expect: clean
pnpm vitest run                           # expect: 16 files / 149 tests passed
```

The pre-change baseline is 149 passing tests; the rename must keep it at 149.
A `Cannot find module './bmp'` tsc error means an importer in step 2 was missed.

## Out of scope (separate follow-ups from the same review)

- Relocating the domain `Mode` union out of `priority_split/mode-icon.tsx`
  (currently imported by `config/types.ts` — inverted dependency).
- Lifting the duplicated format→artefact dispatch in both `service.ts` into a
  shared helper (it encodes the ADR-0004 contract).
- `toJsonView` snake_case-casing convention divergence between the two features.
