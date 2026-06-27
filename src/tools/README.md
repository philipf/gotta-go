# gotta-go tools

## fetch-nz-holidays

Fetches NZ public holidays for the current and next calendar year, filters to
national holidays and Wellington-region (NZ-WGN) holidays, and stores the result
in Cloudflare KV for the `dual_month_calendar` worker feature to consume.

Run this once a year — ideally in November/December before the new year rolls over.

---

### Data source

[Nager.Date public API](https://date.nager.at) — free, no auth required.

Endpoints called:
```
GET https://date.nager.at/api/v3/PublicHolidays/{year}/NZ
```

Called twice: once for the current year, once for the next year. Results are
merged and sorted by date.

**Filter:** keeps a holiday if `global === true` (applies nationwide) **or**
`counties` includes `"NZ-WGN"` (Wellington region).

---

### Data destination

Cloudflare KV namespace: **`PUBLIC_HOLIDAYS`**
KV namespace ID: `e6f049c0ba6a47cd8cb620223ed13c15`

Key written: `public-holidays:NZ:current`

Value format:
```json
[
  { "date": "2026-01-01", "name": "New Year's Day" },
  { "date": "2026-01-19", "name": "Wellington Anniversary Day" },
  ...
]
```

---

### Credentials

You will need three values. Get them from the Cloudflare dashboard:

| Variable | Where to find it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → "Edit Cloudflare Workers" template is sufficient |
| `CLOUDFLARE_ACCOUNT_ID` | [dash.cloudflare.com](https://dash.cloudflare.com) → select any domain → right-hand sidebar shows **Account ID** |
| `KV_NAMESPACE_ID` | Already set in `.mise.local.toml.example` — only changes if the namespace is recreated |

Create `src/tools/.mise.local.toml` (gitignored) from the example:

```bash
cp .mise.local.toml.example .mise.local.toml
# then edit .mise.local.toml with real values
```

---

### Install and run

```bash
cd src/tools
mise trust          # first time only
pnpm install        # first time only, or after a node version change
mise run fetch-holidays
```

The JSON list of holidays is printed to stdout and written to KV.

---

### Verify it worked

**From stdout** — the script prints the full JSON on success. If the list looks
right (national holidays + Wellington Anniversary Day present, two years of data),
it worked.

**From wrangler** — read the key back from KV:

```bash
cd src/worker
pnpm wrangler kv key get "public-holidays:NZ:current" --namespace-id e6f049c0ba6a47cd8cb620223ed13c15 --remote
```

**From the Cloudflare dashboard** — Workers & Pages → KV → `PUBLIC_HOLIDAYS` →
View → search for `public-holidays:NZ:current`.

---

## seed-local-holidays

Same data as `fetch-nz-holidays`, but written to the **local** wrangler/miniflare
KV store that `wrangler dev` reads — so the `dual_month_calendar` feature shades
public holidays in local development. Without it, `wrangler dev` starts with an
empty local KV and the worker soft-misses to an unshaded calendar (holidays are
decoration, never an error), so it's easy to think holidays are "broken" when the
local store simply hasn't been seeded.

**No Cloudflare credentials needed** — it writes through `wrangler kv ... --local`,
not the REST API. It fetches from the same Nager.Date source and applies the same
national + Wellington filter as `fetch-nz-holidays` (the shared logic lives in
`nz-holidays.ts`).

### Run

```bash
cd src/tools
mise trust          # first time only
pnpm install        # first time only, or after a node version change
mise run seed-local-holidays
```

The key is written to the local store under `src/worker/.wrangler/state`. Re-run it
any time you blow away that state, or once a year alongside `fetch-holidays`.

### Verify it worked

```bash
cd src/worker
pnpm wrangler kv key get "public-holidays:NZ:current" --binding PUBLIC_HOLIDAYS --local
```

Or just start `wrangler dev` and render the calendar — June's King's Birthday and
July's Matariki (for 2026) should be shaded.
