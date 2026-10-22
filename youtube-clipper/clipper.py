#!/usr/bin/env python3
"""Cut clips out of a YouTube video (or a local video file).

Examples:
  clipper.py URL --start 1:23 --end 2:10
  clipper.py URL --start 90 --duration 30 --vertical
  clipper.py URL --clips clips.txt            # many clips in one run
  clipper.py my_video.mp4 --start 0:10 --end 0:40

clips.txt: one clip per line, "start end [name]"; blank lines and # comments ignored.
Requires ffmpeg on PATH; yt-dlp (pip install yt-dlp) for URLs.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def parse_time(text):
    """'90', '1:30', '01:02:03' or '1:30.5' -> seconds."""
    parts = str(text).strip().split(":")
    if not 1 <= len(parts) <= 3:
        raise ValueError(f"bad timestamp: {text!r}")
    seconds = 0.0
    for p in parts:
        seconds = seconds * 60 + float(p)
    return seconds


def fmt_time(seconds):
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def slug(text):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or "clip"


def run(cmd):
    print("+", " ".join(cmd), file=sys.stderr)
    subprocess.run(cmd, check=True)


def is_url(source):
    return re.match(r"https?://", source) is not None


def fetch_section(url, start, end, workdir):
    """Download only [start, end] of the video with yt-dlp; return the file path."""
    template = str(Path(workdir) / "section.%(ext)s")
    run([
        "yt-dlp", "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "--download-sections", f"*{fmt_time(start)}-{fmt_time(end)}",
        "--force-keyframes-at-cuts",
        "-o", template, url,
    ])
    files = list(Path(workdir).glob("section.*"))
    if not files:
        sys.exit("yt-dlp produced no output")
    return files[0]


def encode(src, dest, start, end, vertical, fast):
    """Cut src from start..end (seconds, relative to src) into dest."""
    cmd = ["ffmpeg", "-y", "-ss", fmt_time(start), "-i", str(src), "-t", fmt_time(end - start)]
    if fast and not vertical:
        cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    else:
        if vertical:  # centre-crop to 9:16 for Shorts/Reels/TikTok
            cmd += ["-vf", "crop=ih*9/16:ih,scale=1080:1920"]
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]
    cmd.append(str(dest))
    run(cmd)


def make_clip(source, start, end, dest, vertical, fast):
    if end <= start:
        sys.exit(f"end ({end}s) must be after start ({start}s)")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if is_url(source):
        with tempfile.TemporaryDirectory() as tmp:
            section = fetch_section(source, start, end, tmp)
            encode(section, dest, 0, end - start, vertical, fast=False)
    else:
        encode(source, dest, start, end, vertical, fast)
    print(f"saved {dest}")


def read_clips(path):
    clips = []
    for n, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split(None, 2)
        if len(fields) < 2:
            sys.exit(f"{path}:{n}: expected 'start end [name]'")
        clips.append((parse_time(fields[0]), parse_time(fields[1]),
                      fields[2] if len(fields) > 2 else None))
    return clips


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="YouTube URL or local video file")
    ap.add_argument("--start", help="clip start (seconds or [H:]MM:SS)")
    ap.add_argument("--end", help="clip end")
    ap.add_argument("--duration", help="clip length instead of --end")
    ap.add_argument("--clips", help="file with many clips: 'start end [name]' per line")
    ap.add_argument("--out", default="clips", help="output directory (default: clips)")
    ap.add_argument("--name", help="output file name (single clip, no extension)")
    ap.add_argument("--vertical", action="store_true", help="centre-crop to 9:16 (1080x1920)")
    ap.add_argument("--fast", action="store_true",
                    help="local files only: stream-copy, instant but cuts snap to keyframes")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    if is_url(args.source) and not shutil.which("yt-dlp"):
        sys.exit("yt-dlp not found: pip install yt-dlp")
    if not is_url(args.source) and not Path(args.source).is_file():
        sys.exit(f"file not found: {args.source}")

    if args.clips:
        clips = read_clips(args.clips)
    elif args.start is not None and (args.end or args.duration):
        start = parse_time(args.start)
        end = parse_time(args.end) if args.end else start + parse_time(args.duration)
        clips = [(start, end, args.name)]
    else:
        ap.error("give --start with --end/--duration, or --clips FILE")

    out = Path(args.out)
    for i, (start, end, name) in enumerate(clips, 1):
        name = slug(name) if name else f"clip_{i:02d}_{int(start)}-{int(end)}"
        make_clip(args.source, start, end, out / f"{name}.mp4", args.vertical, args.fast)


if __name__ == "__main__":
    main()
