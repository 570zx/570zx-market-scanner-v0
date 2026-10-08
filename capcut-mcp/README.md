# CapCut Android MCP

Lets Claude see and control CapCut on **your own** Android phone through ADB.
It runs on your computer (not in the cloud), so the phone stays on your network/USB.

## Setup
1. On the phone: Settings > About > tap Build number 7 times, then Developer options > enable **USB debugging**
   (or Wireless debugging).
2. On your computer: install [Android platform-tools](https://developer.android.com/tools/releases/platform-tools)
   and run `adb devices`; accept the prompt on the phone.
3. `pip install -r requirements.txt`
4. Register with Claude Code:
   ```
   claude mcp add capcut -- python /path/to/capcut-mcp/server.py
   ```
   Claude Desktop: add the same command under `mcpServers` in its config.

## Tools
`device_info`, `open_capcut`, `screenshot`, `ui_tree`, `tap`, `long_press`, `swipe`, `type_text`,
`press_key`, `push_media`, `pull_file`, `list_remote`, and `shell` (off unless `CAPCUT_MCP_ALLOW_SHELL=1`).

## Env vars
- `CAPCUT_PACKAGE` (default `com.lemon.lvoverseas`; use `com.lemon.lvoverseas`-variant for your region,
  check with `adb shell pm list packages | grep -i lemon`)
- `ANDROID_SERIAL` to choose a device
- `CAPCUT_MCP_ALLOW_SHELL=1` for raw shell

## Safety
Claude can do anything you can by tapping: delete projects, post/export, open other apps.
Watch the first sessions, keep the phone unlocked only while you're present, and turn USB debugging off when done.
Untested against a real device (written without phone access) - report issues and I'll fix them.

## Run it all from the phone (Termux)
Install Termux from F-Droid, clone this repo, then `bash capcut-mcp/termux-setup.sh`.
It installs the dependencies and Claude Code, registers the server, and prints the one-time
wireless-debugging pairing steps (`adb pair localhost:...`, `adb connect localhost:...`).
Needs Android 11+ and Wi-Fi. Untested on a real device.
