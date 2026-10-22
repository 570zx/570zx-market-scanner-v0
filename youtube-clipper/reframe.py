"""Speaker-follow reframing: smoothed face-tracking crop for 9:16 from 16:9."""
import json
import subprocess


def probe_size(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height", "-of", "json", str(src)],
                         check=True, capture_output=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    return s["width"], s["height"]


def face_track(src, start, length, step=0.2):
    """[(t, face_centre_x_fraction)] sampled every `step`s; None where no face was found."""
    try:
        import cv2
    except ImportError:
        return None
    cap = cv2.VideoCapture(str(src))
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    every = max(int(round(fps * step)), 1)
    track, n = [], 0
    while n / fps < length:
        ok = cap.grab()
        if not ok:
            break
        if n % every == 0:
            ok, frame = cap.retrieve()
            if ok:
                h, w = frame.shape[:2]
                scale = 640 / w
                gray = cv2.cvtColor(cv2.resize(frame, (640, int(h * scale))), cv2.COLOR_BGR2GRAY)
                faces = detector.detectMultiScale(gray, 1.1, 6, minSize=(30, 30))
                if len(faces) == 0:
                    faces = profile.detectMultiScale(gray, 1.1, 6, minSize=(30, 30))
                if len(faces):
                    x, _, fw, fh = max(faces, key=lambda f: f[2] * f[3])  # biggest face
                    track.append((n / fps, (x + fw / 2) / 640))
                else:
                    track.append((n / fps, None))
        n += 1
    cap.release()
    return track


def smooth(track, crop_frac, hold=1.5):
    """Turn raw detections into calm camera positions.
    - gaps hold the last position (centre if none was ever seen)
    - small movements are ignored (dead zone), larger ones eased in
    - big jumps (cuts / other speaker) snap instead of panning across the frame"""
    half = crop_frac / 2
    pts, cur, last_seen = [], None, None
    for t, x in track:
        if x is None and cur is not None and last_seen is not None and t - last_seen < hold:
            pts.append((t, cur))
            continue
        if x is None:
            continue
        last_seen = t
        x = min(max(x, half), 1 - half)
        if cur is None or abs(x - cur) > crop_frac * 0.6:      # cut: snap
            cur = x
        elif abs(x - cur) > crop_frac * 0.08:                   # dead zone, then ease
            cur += (x - cur) * 0.25
        pts.append((t, cur))
    return pts


def crop_x_expr(pts, length, src_w, crop_w):
    """ffmpeg expression for the crop's left edge over time (piecewise linear)."""
    if not pts:
        return f"(iw-{crop_w})/2"
    keys, last_t = [], -1.0
    for t, f in pts:                      # one keyframe per ~0.4s is plenty
        if t - last_t >= 0.4:
            keys.append((t, f * src_w - crop_w / 2))
            last_t = t
    keys = [(t, min(max(x, 0), src_w - crop_w)) for t, x in keys]
    expr = f"{keys[0][1]:.1f}"
    for (t0, x0), (t1, x1) in zip(keys, keys[1:]):
        if abs(x1 - x0) < 0.5:
            continue
        # glide to the next position over at most 0.4s
        d = max(min(t1 - t0, 0.4), 0.05)
        expr += f"+({x1 - x0:.1f})*clip((t-{t0:.2f})/{d:.2f},0,1)"
    return expr
