#!/usr/bin/env bash
#
# flash.sh — compile, upload, and watch the radiator firmware on a LilyGo
# T5 4.7" (ESP32-S3) against a chosen environment (dev or prod).
#
# Settings are environment-specific: settings.h.dev and settings.h.prod hold
# the per-env FRAME_URL / RADIATOR_TOKEN / RADIATOR_VERBOSE values. This script
# copies the chosen variant onto settings.h (the file the sketch #includes —
# a generated, gitignored, throwaway file), then runs:
#
#   cp settings.h.<env> → settings.h → arduino-cli compile → upload → tio
#
# Compile runs BEFORE the ROM-download-mode button dance, so a bad arg or a
# broken build fails before you touch the board.
#
# Usage:
#   ./flash.sh dev      # local Worker via cloudflared quick tunnel
#   ./flash.sh prod     # deployed Worker on *.workers.dev
#
# Run from anywhere; it operates on its own directory (src/radiator/), where
# sketch.yaml pins the FQBN and serial port.

set -euo pipefail

PORT=/dev/ttyACM0

# Operate on the sketch dir this script lives in, regardless of cwd.
cd "$(dirname "$(readlink -f "$0")")"

# --- Parse + validate the environment arg ----------------------------------
ENV="${1:-}"

usage() {
  echo "Usage: $0 {dev|prod}" >&2
  echo >&2
  echo "  dev   flash against the local Worker (settings.h.dev)" >&2
  echo "  prod  flash against the deployed Worker (settings.h.prod)" >&2
}

case "$ENV" in
  dev|prod) ;;
  "")
    echo "Error: no environment given." >&2
    usage
    exit 1
    ;;
  *)
    echo "Error: unknown environment '$ENV'." >&2
    usage
    exit 1
    ;;
esac

VARIANT="settings.h.$ENV"
if [[ ! -f "$VARIANT" ]]; then
  echo "Error: $VARIANT not found — create it (copy from settings.example.h)." >&2
  exit 1
fi

# --- Apply the variant + summarise -----------------------------------------
cp "$VARIANT" settings.h

# Pull FRAME_URL out of the variant for an eyeball check (no prod confirm
# prompt — this summary is the sanity check). The token is intentionally NOT
# printed; we only confirm one is set.
FRAME_URL="$(sed -n 's/^#define FRAME_URL[[:space:]]*"\(.*\)".*/\1/p' "$VARIANT")"
if grep -q '^#define RADIATOR_TOKEN[[:space:]]*"..*"' "$VARIANT"; then
  TOKEN_STATE="set"
else
  TOKEN_STATE="MISSING"
fi

echo "Deploying ${ENV^^}"
echo "  FRAME_URL      ${FRAME_URL:-<unset>}"
echo "  RADIATOR_TOKEN ${TOKEN_STATE} (hidden)"
echo

# --- Compile (before the button dance) -------------------------------------
arduino-cli compile

# --- ROM download mode dance -----------------------------------------------
cat <<'EOF'
Put the board into ROM download (flash) mode before continuing:

  Facing the screen, BOOT is the 2nd button and RESET is the 3rd button.

  1. Hold BOOT down.
  2. While holding BOOT, briefly tap RESET.
  3. Release BOOT.

The board is now waiting for an upload.
EOF

read -r -p "Press Enter once the board is in flash mode (Ctrl-C to abort)... "

# --- Upload, watch ---------------------------------------------------------
arduino-cli upload

echo
echo "Opening serial monitor on $PORT at 115200 baud."
echo "To exit tio: press Ctrl-t then q."
echo

# -m INLCRNL maps received NL -> CR-NL; the firmware emits bare LF, so without
# this tio shows a "staircase" (each line starts where the last one ended).
tio -b 115200 -m INLCRNL "$PORT"
