"""MCP server that lets Claude see and control CapCut on your own Android phone via ADB."""
import os
import re
import subprocess

from mcp.server.fastmcp import FastMCP, Image

CAPCUT_PKG = os.environ.get("CAPCUT_PACKAGE", "com.lemon.lvoverseas")  # CapCut (global)
SERIAL = os.environ.get("ANDROID_SERIAL")  # optional: pick a device when several are attached
ALLOW_SHELL = os.environ.get("CAPCUT_MCP_ALLOW_SHELL") == "1"

mcp = FastMCP("capcut-android")


def adb(*args: str, binary: bool = False, timeout: int = 60):
    cmd = ["adb"] + (["-s", SERIAL] if SERIAL else []) + list(args)
    r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors="replace").strip() or "adb failed")
    return r.stdout if binary else r.stdout.decode(errors="replace")


@mcp.tool()
def device_info() -> str:
    """Show the connected phone, screen size and whether CapCut is installed."""
    model = adb("shell", "getprop", "ro.product.model").strip()
    size = adb("shell", "wm", "size").strip()
    pkgs = adb("shell", "pm", "list", "packages", "capcut|lemon").strip()
    return f"{model}\n{size}\ninstalled: {CAPCUT_PKG in adb('shell', 'pm', 'list', 'packages')}\n{pkgs}"


@mcp.tool()
def open_capcut() -> str:
    """Launch (or bring to front) the CapCut app."""
    return adb("shell", "monkey", "-p", CAPCUT_PKG, "-c", "android.intent.category.LAUNCHER", "1")


@mcp.tool()
def screenshot() -> Image:
    """Take a screenshot of the phone. Use this to see what CapCut is showing."""
    return Image(data=adb("exec-out", "screencap", "-p", binary=True), format="png")


@mcp.tool()
def ui_tree() -> str:
    """Dump on-screen UI elements (text, content-desc, bounds). Handy for finding tap targets.
    CapCut draws some views itself, so fall back to screenshot() when this is sparse."""
    xml = adb("exec-out", "uiautomator", "dump", "/dev/tty")
    rows = []
    for m in re.finditer(r'<node[^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="([^"]*)"', xml):
        text, desc, bounds = m.groups()
        if text or desc:
            rows.append(f"{text or desc} {bounds}")
    return "\n".join(rows) or "(no labelled elements)"


@mcp.tool()
def tap(x: int, y: int) -> str:
    """Tap at pixel coordinates."""
    adb("shell", "input", "tap", str(x), str(y))
    return "ok"


@mcp.tool()
def long_press(x: int, y: int, ms: int = 800) -> str:
    """Press and hold at pixel coordinates."""
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(ms))
    return "ok"


@mcp.tool()
def swipe(x1: int, y1: int, x2: int, y2: int, ms: int = 300) -> str:
    """Swipe/drag between two points (scroll, scrub the timeline, move clips)."""
    adb("shell", "input", "swipe", *map(str, (x1, y1, x2, y2, ms)))
    return "ok"


@mcp.tool()
def type_text(text: str) -> str:
    """Type into the focused text field (ASCII only)."""
    adb("shell", "input", "text", text.replace(" ", "%s"))
    return "ok"


@mcp.tool()
def press_key(key: str) -> str:
    """Press a key: BACK, HOME, ENTER, DEL, APP_SWITCH, VOLUME_UP, ... (or a numeric keycode)."""
    adb("shell", "input", "keyevent", key if key.isdigit() else f"KEYCODE_{key.upper()}")
    return "ok"


@mcp.tool()
def push_media(local_path: str, remote_name: str | None = None) -> str:
    """Copy a video/image/audio file from this computer to the phone's Movies folder
    and trigger a media scan so CapCut can import it."""
    remote = f"/sdcard/Movies/{remote_name or os.path.basename(local_path)}"
    adb("push", local_path, remote, timeout=600)
    adb("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", f"file://{remote}")
    return f"pushed to {remote}"


@mcp.tool()
def pull_file(remote_path: str, local_path: str) -> str:
    """Copy a file from the phone (e.g. an exported video in /sdcard/DCIM/Camera) to this computer."""
    adb("pull", remote_path, local_path, timeout=600)
    return f"saved {local_path}"


@mcp.tool()
def list_remote(path: str = "/sdcard/DCIM") -> str:
    """List a folder on the phone."""
    return adb("shell", "ls", "-lt", path)


@mcp.tool()
def shell(command: str) -> str:
    """Run an arbitrary adb shell command. Disabled unless CAPCUT_MCP_ALLOW_SHELL=1."""
    if not ALLOW_SHELL:
        raise RuntimeError("shell disabled; set CAPCUT_MCP_ALLOW_SHELL=1 to enable")
    return adb("shell", command)


if __name__ == "__main__":
    mcp.run()
