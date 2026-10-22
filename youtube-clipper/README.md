# youtube-clipper

Cut upload-ready clips from a YouTube video (or local file) by timestamp.

    pip install yt-dlp        # needs ffmpeg too
    python clipper.py "https://youtu.be/VIDEO_ID" --start 1:23 --end 2:10
    python clipper.py URL --start 90 --duration 30 --vertical        # 9:16, fills frame
    python clipper.py URL --start 90 --duration 30 --vertical blur   # 9:16, whole frame on blurred bg
    python clipper.py URL --clips clips.txt                          # batch

`clips.txt` (one per line, `start end [name]`):

    0:15 0:45 intro_hook
    12:03 12:58 best_moment

## Quality
- Downloads the best available video+audio once (cached in `./downloads/`), so batches reuse it.
- Every clip is cut from the original streams with a single frame-accurate encode:
  H.264 High, CRF 16, slow preset, yuv420p/BT.709, 256k AAC, `+faststart`.
- Audio normalised to -14 LUFS (`--no-loudnorm` to skip); 0.25s fades (`--fade 0` to skip).
- Horizontal clips are never output below 1080p; vertical is 1080x1920.
- `--fast` (local files only) stream-copies for instant keyframe-snapped cuts.
