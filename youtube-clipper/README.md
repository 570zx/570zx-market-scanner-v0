# youtube-clipper

Cut clips from a YouTube video (or local file) by timestamp.

    pip install yt-dlp        # needs ffmpeg too
    python clipper.py "https://youtu.be/VIDEO_ID" --start 1:23 --end 2:10
    python clipper.py URL --start 90 --duration 30 --vertical   # 9:16 for Shorts/Reels
    python clipper.py URL --clips clips.txt                     # batch

`clips.txt` (one per line, `start end [name]`):

    0:15 0:45 intro_hook
    12:03 12:58 best_moment

Only the requested section is downloaded for URLs. Clips land in `./clips/`.
`--fast` (local files only) stream-copies for instant, keyframe-snapped cuts.
