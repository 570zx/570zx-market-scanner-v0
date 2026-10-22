"""Word-timed burned-in captions: faster-whisper transcription -> ASS subtitles."""
import subprocess
from pathlib import Path

GOLD = r"{\c&H00D7FF&}"   # active word (BGR)
WHITE = r"{\c&HFFFFFF&}"


def transcribe(src, start, length, model_name, language, workdir):
    """Return [(word, start, end)] with times relative to the clip start."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise SystemExit("captions need faster-whisper: pip install faster-whisper")
    wav = Path(workdir) / "audio.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-i", str(src),
                    "-t", str(length), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    model = WhisperModel(model_name, device="auto", compute_type="auto")
    segments, _ = model.transcribe(str(wav), word_timestamps=True, vad_filter=True,
                                   language=language)
    return [(w.word.strip(), w.start, w.end) for s in segments for w in s.words if w.word.strip()]


def _stamp(t):
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _chunks(words, max_words, max_gap=0.6):
    chunk = []
    for w in words:
        if chunk and (len(chunk) >= max_words or w[1] - chunk[-1][2] > max_gap):
            yield chunk
            chunk = []
        chunk.append(w)
        if w[0][-1] in ".?!":
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def build_ass(words, width, height, vertical, font):
    """Karaoke-style captions: a few words at a time, the spoken word highlighted.
    Vertical captions sit at ~65% height, clear of the platform UI in the bottom 20%."""
    if vertical:
        size, outline, margin_v, max_words = round(height * 0.044), round(height * 0.004), round(height * 0.32), 3
    else:
        size, outline, margin_v, max_words = round(height * 0.055), round(height * 0.004), round(height * 0.07), 6
    margin_h = round(width * 0.06)
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}", "WrapStyle: 2",
        "", "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
        "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,"
        f"{outline},{max(outline // 2, 1)},2,{margin_h},{margin_h},{margin_v},1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for chunk in _chunks(words, max_words):
        texts = [w[0].upper() if vertical else w[0] for w in chunk]
        for i, (_, start, end) in enumerate(chunk):
            end = chunk[i + 1][1] if i + 1 < len(chunk) else end + 0.15
            line = " ".join(f"{GOLD if j == i else WHITE}{t}" for j, t in enumerate(texts))
            lines.append(f"Dialogue: 0,{_stamp(start)},{_stamp(end)},Default,,0,0,0,,{line}")
    return "\n".join(lines) + "\n"
