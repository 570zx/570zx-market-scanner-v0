#!/usr/bin/env python3
"""Cut clips out of a YouTube video (or a local video file).

Examples:
  clipper.py URL --start 1:23 --end 2:10
  clipper.py URL --start 90 --duration 30 --vertical
  clipper.py URL --clips clips.txt            # many clips in one run
  clipper.py my_video.mp4 --start 0:10 --end 0:40

clips.txt: one clip per line, "start end [name]"; blank lines and # comments ignored.
Requires ffmpeg on PATH; yt-dlp (pip install yt-dlp) for URLs.
Quality: downloads the best source once, cuts frame-accurately with one
H.264 CRF16 encode, -14 LUFS audio, 256k AAC, faststart MP4.
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


def fetch_source(url, cache):
    """Download the best-quality video+audio once (cached) so every clip is cut
    from the original streams with a single encode."""
    cache.mkdir(parents=True, exist_ok=True)
    video_id = subprocess.run(["yt-dlp", "--get-id", url], check=True,
                              capture_output=True, text=True).stdout.split()[0]
    hits = [p for p in cache.glob(f"{video_id}.*") if p.suffix not in (".part", ".ytdl")]
    if hits:
        return hits[0]
    run(["yt-dlp", "-f", "bv*+ba/b", "-S", "res,fps,hdr:sdr,vcodec,acodec",
         "--merge-output-format", "mkv", "-o", str(cache / "%(id)s.%(ext)s"), url])
    hits = [p for p in cache.glob(f"{video_id}.*") if p.suffix not in (".part", ".ytdl")]
    if not hits:
        sys.exit("yt-dlp produced no output")
    return hits[0]


def build_filter(vertical, fade, length):
    """Video filter graph; returns (-vf/-filter_complex flag, graph)."""
    fades = f",fade=t=in:d={fade},fade=t=out:st={max(length - fade, 0):.3f}:d={fade}" if fade else ""
    if vertical == "crop":  # fill the frame, centre-crop
        g = f"crop='min(iw,ih*9/16)':ih,scale=1080:1920:flags=lanczos,setsar=1{fades}"
        return "-vf", g
    if vertical == "blur":  # whole frame on top of a blurred copy of itself
        g = ("split[a][b];"
             "[a]scale=1080:1920:force_original_aspect_ratio=increase:flags=bilinear,"
             "crop=1080:1920,boxblur=30:5[bg];"
             "[b]scale=1080:-2:flags=lanczos[fg];"
             f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1{fades}")
        return "-filter_complex", g
    g = f"scale=-2:'max(ih,1080)':flags=lanczos,setsar=1{fades}"  # never ship below 1080p
    return "-vf", g


def encode(src, dest, start, end, vertical, fast, fade, loudnorm):
    """Cut src from start..end (seconds) into dest, ready to upload."""
    length = end - start
    cmd = ["ffmpeg", "-y", "-ss", fmt_time(start), "-i", str(src), "-t", fmt_time(length)]
    if fast and not vertical:
        cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    else:
        flag, graph = build_filter(vertical, fade, length)
        cmd += [flag, graph,
                "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high",
                "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
                "-color_trc", "bt709", "-movflags", "+faststart"]
        af = []
        if loudnorm:  # YouTube/Shorts/Reels/TikTok all sit around -14 LUFS
            af.append("loudnorm=I=-14:TP=-1.5:LRA=11")
        if fade:
            af.append(f"afade=t=in:d={fade},afade=t=out:st={max(length - fade, 0):.3f}:d={fade}")
        if af:
            cmd += ["-af", ",".join(af)]
        cmd += ["-c:a", "aac", "-b:a", "256k", "-ar", "48000"]
    cmd.append(str(dest))
    run(cmd)


def make_clip(source, start, end, dest, args):
    if end <= start:
        sys.exit(f"end ({end}s) must be after start ({start}s)")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if is_url(source):
        source = fetch_source(source, Path(args.cache))
    encode(source, dest, start, end, args.vertical, args.fast, args.fade, not args.no_loudnorm)
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
    ap.add_argument("--vertical", nargs="?", const="crop", choices=["crop", "blur"],
                    help="9:16 1080x1920 for Shorts/Reels/TikTok: 'crop' fills the frame "
                         "(default), 'blur' keeps the whole frame over a blurred background")
    ap.add_argument("--fade", type=float, default=0.25, help="fade in/out seconds (default 0.25, 0 = off)")
    ap.add_argument("--no-loudnorm", action="store_true", help="skip -14 LUFS loudness normalisation")
    ap.add_argument("--cache", default="downloads", help="where full source downloads are kept")
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
        make_clip(args.source, start, end, out / f"{name}.mp4", args)


if __name__ == "__main__":
    main()
