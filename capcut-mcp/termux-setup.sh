#!/data/data/com.termux/files/usr/bin/bash
# Run inside Termux (F-Droid build) on the phone that has CapCut.
set -e

pkg update -y
pkg install -y python android-tools nodejs git rust binutils clang make libffi openssl

DIR="$(cd "$(dirname "$0")" && pwd)"
# mcp depends on Rust-built wheels (pydantic-core, rpds-py); build with Termux's rust
export ANDROID_API_LEVEL="$(getprop ro.build.version.sdk)"
export CARGO_BUILD_TARGET="$(rustc -vV | sed -n 's/^host: //p')"
pip install -r "$DIR/requirements.txt"
npm install -g @anthropic-ai/claude-code

# Keep Termux alive while CapCut is in the foreground
command -v termux-wake-lock >/dev/null && termux-wake-lock || true

# Register the MCP server (skip if already added)
claude mcp add capcut -- python "$DIR/server.py" 2>/dev/null || true

cat <<MSG

Install done. Now connect ADB to this phone (one-time pairing):
  1. Settings > Developer options > Wireless debugging: ON (Wi-Fi required)
  2. Tap "Pair device with pairing code"; open Termux in split-screen/floating window
  3. adb pair localhost:<pairing-port>     # enter the 6-digit code
  4. adb connect localhost:<port>          # port shown on the main Wireless debugging screen
  5. adb devices                           # should list the phone

Then run:  claude
Tip: float or split-screen Termux next to CapCut so screenshots show CapCut.
Also exempt Termux from battery optimization (Settings > Apps > Termux > Battery).
Re-run step 4 if Wi-Fi changes or the phone restarts.
MSG
