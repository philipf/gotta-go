#!/usr/bin/env bash
#
# Production smoke test for the deployed gotta-go Worker.
#
# Confirms the Worker answers a real wake cycle: it hits GET /v1/frame for the
# bedroom-philip-tania radiator exactly as the physical radiator does — the BMP
# path, no Accept header — and asserts the frame actually rendered (HTTP 200
# plus the X-Profile-Phase observability header the frame path always sets). A
# bare 200 without a resolved profile phase is treated as a failure.
#
# Auth uses the X-Radiator-Token header (NOT Authorization: Bearer — the Worker
# validates X-Radiator-Token in src/worker/auth/validate.ts).
#
# RADIATOR_SHARED_TOKEN is loaded by mise from the local .env file; run via:
#   mise run smoke        # from tests/
#
# BASE_URI defaults to production but can be overridden, e.g.:
#   BASE_URI=http://localhost:8787 mise run smoke
set -euo pipefail

BASE_URI="${BASE_URI:-https://gotta-go-worker.philip-fourie-4ad.workers.dev}"
SLUG="bedroom-philip-tania"

hdr="$(mktemp)"
trap 'rm -f "$hdr"' EXIT

status="$(curl -sS --max-time 30 \
  "${BASE_URI}/v1/frame" \
  -H "X-Radiator-Slug: ${SLUG}" \
  -H "X-Radiator-Token: ${RADIATOR_SHARED_TOKEN}" \
  -o /dev/null -D "$hdr" -w '%{http_code}')"

cat "$hdr"

phase="$(grep -i '^x-profile-phase:' "$hdr" | tr -d '\r' | head -n1 | cut -d' ' -f2-)"

if [[ "$status" == "200" && -n "$phase" ]]; then
  echo "PASS: ${BASE_URI} answered a wake cycle for ${SLUG} (profile_phase=${phase})"
  exit 0
fi

echo "FAIL: status=${status:-?} profile_phase=${phase:-<missing>}" >&2
exit 1
