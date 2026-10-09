#!/usr/bin/env python3
"""Find 3D model / texture requests in a HAR capture and optionally download them.

Usage:
  har_model_finder.py capture.har [--download] [--out DIR]
  har_model_finder.py urls.txt    [--download] [--out DIR]   # one URL per line, or the JSON
                                                             # array from the snippet below

Downloads use a plain GET with a default User-Agent. If a server answers 401/403/429
the script reports it and stops for that file; it does not retry with spoofed headers,
cookies, or challenge-solving.

Address-bar snippet (no HAR needed), run on the loaded viewer page:
  javascript:document.body.innerText=JSON.stringify(performance.getEntriesByType('resource').map(r=>r.name))
"""
import argparse, json, os, re, struct, sys, urllib.error, urllib.parse, urllib.request

TEX_WORDS = re.compile(r"texture|diffuse|albedo|basecolor|normal|roughness|metal|occlusion|emissive|\bmap\b", re.I)
MODEL_EXTS = (".glb", ".gltf", ".qlb", ".usdz")
IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".ktx2")
SKIP = re.compile(r"(favicon|logo|sprite|icon|avatar|banner|thumb|cdn-cgi|analytics)", re.I)


def load(path):
    """Return list of dicts: url, status, mime, referer, size."""
    text = open(path, encoding="utf-8-sig", errors="replace").read()
    try:
        data = json.loads(text)
    except ValueError:
        return [dict(url=u.strip(), status=None, mime=None, referer=None, size=None)
                for u in text.splitlines() if u.strip().startswith("http")]
    if isinstance(data, list):
        return [dict(url=u, status=None, mime=None, referer=None, size=None) for u in data if isinstance(u, str)]
    out = []
    for e in data.get("log", {}).get("entries", []):
        req, res = e.get("request", {}), e.get("response", {})
        hdr = {h["name"].lower(): h["value"] for h in req.get("headers", [])}
        out.append(dict(
            url=req.get("url", ""),
            status=res.get("status"),
            mime=(res.get("content", {}).get("mimeType") or "").split(";")[0] or None,
            referer=hdr.get("referer") or e.get("_initiator", {}).get("url"),
            size=res.get("content", {}).get("size"),
        ))
    return out


def classify(e):
    path = urllib.parse.urlparse(e["url"]).path.lower()
    mime = (e["mime"] or "").lower()
    if path.endswith(MODEL_EXTS) or "gltf" in mime or mime.startswith("model/"):
        return "MODEL"
    if path.endswith(".bin") or (mime == "application/octet-stream" and re.search(r"model|mesh|3d|glb", e["url"], re.I)):
        return "MODEL?"
    if path.endswith(IMG_EXTS) or mime.startswith("image/"):
        if SKIP.search(e["url"]):
            return None
        return "TEXTURE" if TEX_WORDS.search(e["url"]) else "IMAGE"
    return None


def validate_glb(data):
    """Return (ok, report_lines)."""
    if len(data) < 20 or data[:4] != b"glTF":
        return False, [f"not a GLB (first bytes: {data[:8]!r})"]
    ver, total = struct.unpack("<II", data[4:12])
    r = [f"header ok, version={ver}, declared length={total}, actual={len(data)}"]
    if total != len(data):
        r.append("WARNING: declared length != file size (truncated or padded)")
    clen, ctype = struct.unpack("<II", data[12:20])
    if ctype != 0x4E4F534A:
        return False, r + ["first chunk is not JSON"]
    try:
        j = json.loads(data[20:20 + clen])
    except ValueError as ex:
        return False, r + [f"JSON chunk invalid: {ex}"]
    nverts = 0
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            a = p.get("attributes", {}).get("POSITION")
            if a is not None:
                nverts += j["accessors"][a].get("count", 0)
    ext_uris = [x["uri"] for k in ("images", "buffers") for x in j.get(k, [])
                if x.get("uri") and not x["uri"].startswith("data:")]
    r += [f"asset: {j.get('asset')}",
          f"nodes={len(j.get('nodes', []))} meshes={len(j.get('meshes', []))} vertices(POSITION)={nverts}",
          f"materials={len(j.get('materials', []))} textures={len(j.get('textures', []))} images={len(j.get('images', []))}",
          f"external URIs: {ext_uris or 'none (self-contained)'}",
          f"extensions used: {j.get('extensionsUsed', [])}"]
    return True, r


def download(url, outdir):
    os.makedirs(outdir, exist_ok=True)
    name = os.path.basename(urllib.parse.urlparse(url).path) or "download.bin"
    dest = os.path.join(outdir, name)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; har-model-finder)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            print(f"  GET {resp.status} {resp.headers.get('Content-Type')} {len(body)} bytes")
    except urllib.error.HTTPError as ex:
        print(f"  BLOCKED/FAILED: HTTP {ex.code} ({ex.reason}); not retrying or working around it.")
        return None
    except Exception as ex:
        print(f"  FAILED: {ex}")
        return None
    open(dest, "wb").write(body)
    print(f"  saved {dest}")
    if body[:4] == b"glTF":
        ok, lines = validate_glb(body)
        print("  GLB valid" if ok else "  GLB INVALID")
        for l in lines:
            print("   ", l)
    else:
        print(f"  magic bytes: {body[:16]!r} (not a GLB; format needs separate inspection)")
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("capture")
    ap.add_argument("--download", action="store_true", help="download MODEL candidates and textures")
    ap.add_argument("--out", default="recovered")
    a = ap.parse_args()

    seen, rows = set(), []
    for e in load(a.capture):
        if not e["url"].startswith("http") or e["url"] in seen:
            continue
        kind = classify(e)
        if kind:
            seen.add(e["url"])
            rows.append((kind, e))
    order = {"MODEL": 0, "MODEL?": 1, "TEXTURE": 2, "IMAGE": 3}
    rows.sort(key=lambda r: order[r[0]])

    if not rows:
        print("No model/texture-like requests found. Was the viewer fully loaded (model visible) when capturing?")
        return 1
    for kind, e in rows:
        print(f"[{kind}] {e['url']}\n    status={e['status']} mime={e['mime']} size={e['size']}\n    referer={e['referer']}")

    if a.download:
        print("\n== Downloads ==")
        for kind, e in rows:
            if kind in ("MODEL", "MODEL?", "TEXTURE"):
                if e["status"] not in (None, 200, 206, 304):
                    print(f"skip {e['url']} (captured status {e['status']})")
                    continue
                print(f"{kind} {e['url']}")
                download(e["url"], a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
