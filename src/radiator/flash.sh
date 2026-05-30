#!/usr/bin/env bash
#
# flash.sh — compile, upload, and watch the radiator firmware on a LilyGo
# T5 4.7" (ESP32-S3). Walks the user through the ROM-download-mode button
# dance (the board won't accept an upload over native USB CDC otherwise),
# then runs: arduino-cli compile → upload → tio serial monitor.
#
# Run from anywhere; it operates on its own directory (src/radiator/), where
# sketch.yaml pins the FQBN and serial port.

set -euo pipefail

PORT=/dev/ttyACM0

# Operate on the sketch dir this script lives in, regardless of cwd.
cd "$(dirname "$(readlink -f "$0")")"

# --- Precondition: the board must be enumerated at $PORT -------------------
if [[ ! -e "$PORT" ]]; then
    echo "Error: $PORT not found — is the LilyGo plugged in and powered on?" >&2
    echo "       (check 'ls /dev/ttyACM*' / 'dmesg | tail' if it should be there)" >&2
    exit 1
fi

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

# --- Compile, upload, watch ------------------------------------------------
arduino-cli compile
arduino-cli upload

echo
echo "Opening serial monitor on $PORT at 115200 baud."
echo "To exit tio: press Ctrl-t then q."
echo

# -m INLCRNL maps received NL -> CR-NL; the firmware emits bare LF, so without
# this tio shows a "staircase" (each line starts where the last one ended).
tio -b 115200 -m INLCRNL "$PORT"
