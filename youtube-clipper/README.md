# youtube-clipper

Cut upload-ready clips from a YouTube video (or local file) for YouTube, Shorts, TikTok and Reels.

    pip install -r requirements.txt     # also needs ffmpeg
    python clipper.py "https://youtu.be/VIDEO_ID" --start 1:23 --end 2:10 --platforms --captions
    python clipper.py URL --clips clips.txt --platforms --captions

`--platforms` writes two files per clip: `NAME_youtube.mp4` (16:9) and `NAME_vertical.mp4`
(9:16, 1080x1920, used for Shorts, TikTok and Reels).

`clips.txt` (one per line, `start end [name]`):

    0:15 0:45 intro_hook
    12:03 12:58 best_moment

## Options
- `--vertical [follow|crop|blur]` – single vertical output. `follow` (default) tracks the speaker's
  face with a smoothed crop; `crop` centre-crops; `blur` keeps the whole frame over a blurred background.
- `--captions` – word-by-word burned-in captions (Whisper), spoken word highlighted. Vertical captions
  sit clear of the platform UI. `--whisper-model large-v3` for best accuracy, `--language en`, `--font`.
- `--fade S`, `--no-loudnorm`, `--out DIR`, `--name NAME`, `--cache DIR`.

## Quality
- Downloads the best available video+audio once (cached in `./downloads/`), so batches reuse it.
- Each output is cut from the original streams with a single frame-accurate encode:
  H.264 High, CRF 16, slow preset, yuv420p/BT.709, 256k AAC, `+faststart`.
- Audio normalised to -14 LUFS; 0.25s fades; landscape is never below 1080p.
- `--fast` (local files, no captions) stream-copies for instant keyframe-snapped cuts.

Notes: face tracking uses OpenCV's Haar cascades (front/profile faces; holds position when no face is
seen). Clips over 3 minutes trigger a warning for the Shorts/Reels limit.

## Phone version
`phone-clipper.html` is a single self-contained page: open it in a phone browser, pick the video file,
mark clips and render them on the device (no install, no captions or speaker tracking, real-time
recording, quality limited by the phone's recorder). It needs to be served over https or opened as a file.
