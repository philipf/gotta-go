#!/usr/bin/env bash
#
# flash.sh — compile, upload, and watch the radiator firmware on a LilyGo
# T5 4.7" (ESP32-S3) against a chosen settings variant.
#
# Settings are variant-specific: each settings.<variant>.h file holds one
# deployment's WIFI_* / FRAME_URL / RADIATOR_SLUG / RADIATOR_TOKEN /
# RADIATOR_VERBOSE values (e.g. settings.dev.h for the local Worker via a
# cloudflared quick tunnel; per-device variants like settings.f5.h or
# settings.parents-home.h for the deployed Worker — a device may have several
# variants differing only by WiFi network, e.g. f5 vs f5-tui). The .h
# extension comes last so editors apply C/C++ syntax highlighting. Variants
# are discovered, not hardcoded: any settings.<variant>.h file in this
# directory is a valid argument ("example" excepted — settings.example.h is
# the tracked template, not a flashable variant), so adding a radiator never
# means editing this script — just `cp settings.example.h
# settings.<variant>.h` and fill it in. This script copies the chosen variant
# onto settings.h (the file the sketch #includes — a generated, gitignored,
# throwaway file), then runs:
#
#   cp settings.<variant>.h → settings.h → arduino-cli compile → upload → tio
#
# Compile runs BEFORE the ROM-download-mode button dance, so a bad arg or a
# broken build fails before you touch the board.
#
# Usage:
#   ./flash.sh <variant>   # any <variant> with a settings.<variant>.h file
#   ./flash.sh             # lists the available variants
#
# Run from anywhere; it operates on its own directory (src/radiator/), where
# sketch.yaml pins the FQBN and serial port.

set -euo pipefail

PORT=/dev/ttyACM0

# Operate on the sketch dir this script lives in, regardless of cwd.
cd "$(dirname "$(readlink -f "$0")")"

# --- Parse + validate the variant arg ---------------------------------------
# Variants are discovered from the settings.<variant>.h files present, so a
# new radiator needs a new settings file but never a script change. The
# tracked template settings.example.h matches the shape but is not flashable.
ENV="${1:-}"

usage() {
  echo "Usage: $0 <variant>" >&2
  echo >&2
  echo "Available variants (settings.<variant>.h files in $PWD):" >&2
  local found=0 f v
  for f in settings.*.h; do
    [[ -f "$f" ]] || continue
    v="${f#settings.}"
    v="${v%.h}"
    [[ "$v" == "example" ]] && continue
    echo "  $v" >&2
    found=1
  done
  if [[ "$found" -eq 0 ]]; then
    echo "  (none — copy settings.example.h to settings.<variant>.h and fill it in)" >&2
  fi
}

if [[ -z "$ENV" ]]; then
  echo "Error: no variant given." >&2
  usage
  exit 1
fi

if [[ "$ENV" == "example" ]]; then
  echo "Error: settings.example.h is the template, not a flashable variant." >&2
  usage
  exit 1
fi

VARIANT="settings.$ENV.h"
if [[ ! -f "$VARIANT" ]]; then
  echo "Error: $VARIANT not found." >&2
  usage
  exit 1
fi

# --- Apply the variant + resolve secrets from pass --------------------------
# The variant file holds @pass:<path>@ placeholders instead of plaintext
# secrets; the real values live only in the `pass` store. We copy the variant
# onto settings.h, then swap each placeholder for `pass show <path>`. settings.h
# is generated and gitignored — but it would still hold plaintext at rest after
# the flash, so the trap below restores the placeholder-only variant on exit
# (normal exit OR Ctrl-C during the button dance), keeping the plaintext on
# disk only for the duration of the run.
cp "$VARIANT" settings.h
trap 'cp "$VARIANT" settings.h 2>/dev/null || true' EXIT

resolve_pass_placeholders() {
  local file="$1" path secret esc
  # Each unique @pass:<path>@ token referenced on a #define line. Restricting to
  # #define lines means a placeholder mentioned in a comment is not resolved.
  for path in $(grep '^[[:space:]]*#define' "$file" | grep -o '@pass:[^@]*@' | sed 's/^@pass://; s/@$//' | sort -u || true); do
    if ! secret="$(pass show "$path" 2>/dev/null)"; then
      echo "Error: pass entry '$path' not found (referenced in $VARIANT)." >&2
      echo "       Add it with: pass insert '$path'" >&2
      exit 1
    fi
    secret="${secret%%$'\n'*}"                                # first line only
    esc="$(printf '%s' "$secret" | sed -e 's/[\/&|]/\\&/g')"  # escape for sed RHS
    sed -i "s|@pass:${path}@|${esc}|g" "$file"
  done
}
resolve_pass_placeholders settings.h

# --- Summarise --------------------------------------------------------------
# Pull FRAME_URL, RADIATOR_SLUG and WIFI_SSID out of the *resolved* settings.h
# for an eyeball check (no prod confirm prompt — this summary is the sanity
# check). The slug is the value that distinguishes two deployed-Worker variants
# whose URL and token are identical, so it is the line that catches flashing the
# wrong device personality; the SSID distinguishes same-device variants that
# differ only by network (e.g. f5 vs f5-tui). The WiFi password and token are
# intentionally NOT printed; for the token we only confirm it resolved — which
# also catches a typo'd pass path before the button dance.
FRAME_URL="$(sed -n 's/^#define FRAME_URL[[:space:]]*"\(.*\)".*/\1/p' settings.h)"
SLUG="$(sed -n 's/^#define RADIATOR_SLUG[[:space:]]*"\(.*\)".*/\1/p' settings.h)"
WIFI_SSID="$(sed -n 's/^#define WIFI_SSID[[:space:]]*"\(.*\)".*/\1/p' settings.h)"
if grep -q '^#define RADIATOR_TOKEN[[:space:]]*"..*"' settings.h; then
  TOKEN_STATE="set"
else
  TOKEN_STATE="MISSING"
fi

echo "Deploying ${ENV^^}"
echo "  FRAME_URL      ${FRAME_URL:-<unset>}"
echo "  RADIATOR_SLUG  ${SLUG:-<unset>}"
echo "  WIFI_SSID      ${WIFI_SSID:-<unset>}"
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
