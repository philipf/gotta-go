#!/usr/bin/env python3
"""Export a radiator's wake/battery telemetry from Cloudflare Workers Logs as CSV.

Every radiator wake is a GET /v1/frame invocation; the Worker has
`observability.enabled` (src/worker/wrangler.jsonc), so each invocation lands in
Workers Logs carrying the request headers (`x-radiator-slug`,
`x-radiator-battery-mv`) and the response status. This script reconstructs every
wake (200 and 304 alike) in a time range and prints one CSV row per invocation:

    ts_local,epoch_ms,status,mv

Usage:
    export CF_TOK=...          # API token (never commit it)
    export CF_ACCOUNT=...      # Cloudflare account id
    tools/export_radiator_logs.py office-f5 --from 2026-06-20 --to 2026-07-11 > office-f5.csv

Times are ISO dates or datetimes, interpreted in --tz (default Pacific/Auckland);
--to defaults to now. Output timestamps use the same zone.

Hard-won operational notes (issue #80):
- The token needs BOTH `Account > Workers Observability > Read` AND
  `Account > Account Analytics > Read`. With only the first, queries return
  COMPLETED with zero rows — a silently empty table, not an error.
- Queries are chunked into 6 h windows and the response's `abr_level` is checked:
  a single multi-day window silently downsamples (an 8-day query once returned 7
  events where chunked queries returned 1293). abr_level == 1 means full
  resolution; anything else aborts unless --allow-sampled.
- Even at abr_level 1, Workers Logs drop ~7% of events (ground-truthed against a
  serial capture in #128). Treat wake counts as a lower bound and gaps as
  possible telemetry dropout, not device stalls.
- Retention is ~7 days. Pull and preserve data before it ages out; a warning is
  printed when the range starts earlier than that.
- Filtering on the `x-radiator-slug` request header captures every wake; the
  `frame.completed` console log fires only on 200 renders and would undercount.
- Each invocation can appear as several events (trace + console log), so rows
  are deduped by requestId, keeping the earliest timestamp and any mv/status.
"""

import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

API = "https://api.cloudflare.com/client/v4/accounts/{account}/workers/observability/telemetry/query"
CHUNK_MS = 6 * 3600 * 1000  # keep windows small enough that abr_level stays 1
PAGE_LIMIT = 1000
RETENTION_DAYS = 7


def parse_args():
    p = argparse.ArgumentParser(
        description="Export radiator wake/battery telemetry from Cloudflare Workers Logs as CSV.",
        epilog="Reads the API token from $CF_TOK and the account id from $CF_ACCOUNT (or --account).",
    )
    p.add_argument("slug", help="radiator slug, e.g. office-f5 (x-radiator-slug header value)")
    p.add_argument("--from", dest="frm", required=True, metavar="WHEN",
                   help="range start, ISO date or datetime (e.g. 2026-06-20 or 2026-06-20T19:00)")
    p.add_argument("--to", dest="to", metavar="WHEN", default=None,
                   help="range end, ISO date or datetime (default: now)")
    p.add_argument("--tz", default="Pacific/Auckland",
                   help="IANA zone for interpreting --from/--to and printing timestamps (default: %(default)s)")
    p.add_argument("--account", default=os.environ.get("CF_ACCOUNT"),
                   help="Cloudflare account id (default: $CF_ACCOUNT)")
    p.add_argument("--allow-sampled", action="store_true",
                   help="continue even when a window reports abr_level > 1 (downsampled data)")
    return p.parse_args()


def parse_when(value, tz):
    dt = datetime.datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return int(dt.timestamp() * 1000)


def query(token, account, slug, frm_ms, to_ms):
    body = {
        "queryId": "export-radiator-logs",
        "timeframe": {"from": frm_ms, "to": to_ms},
        "view": "events",
        "limit": PAGE_LIMIT,
        "dry": False,
        "parameters": {
            "datasets": ["cloudflare-workers"],
            "filters": [{
                "key": "$workers.event.request.headers.x-radiator-slug",
                "operation": "eq",
                "value": slug,
                "type": "string",
            }],
        },
    }
    req = urllib.request.Request(
        API.format(account=account),
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            detail = e.read().decode(errors="replace")[:300]
            sys.exit(f"error: HTTP {e.code} from telemetry API: {detail}\n"
                     "(401 with a fresh token? check its start date and that it has BOTH "
                     "Workers Observability Read and Account Analytics Read)")


def get(obj, path):
    for key in path.split("."):
        obj = obj.get(key) if isinstance(obj, dict) else None
    return obj


def pull_window(token, account, slug, frm_ms, to_ms, by_req, allow_sampled):
    """Fetch one window, paginating backwards from to_ms; merge events into by_req."""
    cur_to = to_ms
    while True:
        res = query(token, account, slug, frm_ms, cur_to)["result"]
        abr = get(res, "statistics.abr_level")
        events = res["events"]["events"]
        if abr not in (None, 1):
            msg = f"window ending {cur_to}: abr_level={abr} (downsampled data)"
            if not allow_sampled:
                sys.exit(f"error: {msg}; re-run with --allow-sampled to accept, "
                         "or narrow the range")
            print(f"warning: {msg}", file=sys.stderr)
        if not events:
            return
        oldest = cur_to
        for e in events:
            rid = get(e, "$workers.requestId") or get(e, "$metadata.requestId")
            ts = e["timestamp"]
            rec = by_req.setdefault(rid, {"ts": ts})
            rec["ts"] = min(rec["ts"], ts)
            status = get(e, "$workers.event.response.status")
            if status is not None:
                rec["status"] = status
            mv = get(e, "$workers.event.request.headers.x-radiator-battery-mv")
            if mv is not None:
                rec["mv"] = int(mv)
            oldest = min(oldest, ts)
        if len(events) < PAGE_LIMIT:
            return
        cur_to = oldest


def main():
    args = parse_args()
    token = os.environ.get("CF_TOK")
    if not token:
        sys.exit("error: set CF_TOK to a Cloudflare API token")
    if not args.account:
        sys.exit("error: set CF_ACCOUNT or pass --account")
    tz = ZoneInfo(args.tz)

    now_ms = int(time.time() * 1000)
    frm_ms = parse_when(args.frm, tz)
    to_ms = parse_when(args.to, tz) if args.to else now_ms
    if frm_ms >= to_ms:
        sys.exit("error: --from must be earlier than --to")
    if frm_ms < now_ms - RETENTION_DAYS * 86400_000:
        print(f"warning: range starts more than ~{RETENTION_DAYS} days ago; "
              "Workers Logs retention has likely already dropped the oldest events",
              file=sys.stderr)

    by_req = {}
    w = frm_ms
    while w < to_ms:
        pull_window(token, args.account, args.slug,
                    w, min(w + CHUNK_MS, to_ms), by_req, args.allow_sampled)
        w += CHUNK_MS

    rows = sorted(by_req.values(), key=lambda r: r["ts"])
    print("ts_local,epoch_ms,status,mv")
    for r in rows:
        local = datetime.datetime.fromtimestamp(r["ts"] / 1000, tz)
        print(f"{local:%Y-%m-%d %H:%M:%S},{r['ts']},{r.get('status', '')},{r.get('mv', '')}")
    print(f"{args.slug}: {len(rows)} unique invocations "
          f"({datetime.datetime.fromtimestamp(frm_ms / 1000, tz):%Y-%m-%d %H:%M} -> "
          f"{datetime.datetime.fromtimestamp(to_ms / 1000, tz):%Y-%m-%d %H:%M} {args.tz})",
          file=sys.stderr)


if __name__ == "__main__":
    main()
