"""Upload the 16:9 ad video MP4 to cloud file hosts; verify links work
(re-download, size + sha256 match, ffprobe decode). Same pipeline as upload_adzip.py.
"""
import subprocess, json, sys, pathlib, hashlib

VID = "/home/z/my-project/download/alnokhba-ad-video-16x9.mp4"
NAME = "alnokhba-ad-video-16x9.mp4"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

SHA_LOCAL = sha(VID)
SIZE = pathlib.Path(VID).stat().st_size
print(f"local: {SIZE} bytes sha256={SHA_LOCAL[:16]}…")

def run(args, timeout=300, binary=False):
    r = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA] + args,
                       capture_output=True)
    return r.stdout if binary else r.stdout.decode(errors="replace")

results = []  # (name, page_link, direct_link)

# 1) catbox.moe — permanent anonymous
up = run(["-F", "reqtype=fileupload", "-F", f"fileToUpload=@{VID}",
          "https://catbox.moe/user/api.php"], timeout=600)
if up.strip().startswith("http"):
    results.append(("catbox-permanent", up.strip(), up.strip()))
else:
    print("catbox failed:", up[:200])

# 2) gofile.io
srv = run(["-X", "GET", "https://api.gofile.io/servers"])
try:
    server = json.loads(srv)["data"]["servers"][0]["name"]
    up = run(["-F", f"file=@{VID}", f"https://{server}.gofile.io/contents/uploadfile"], timeout=600)
    j = json.loads(up)
    if j.get("status") == "ok":
        fid, fname = j["data"]["id"], j["data"]["name"]
        results.append(("gofile", j["data"]["downloadPage"],
                        f"https://{server}.gofile.io/download/web/{fid}/{fname}"))
    else:
        print("gofile upload failed:", up[:200])
except Exception as e:
    print("gofile failed:", e, "|", srv[:200])

# 3) pixeldrain — anonymous PUT
pid = run(["-T", VID, "--upload-file", f"https://pixeldrain.com/api/file/{NAME}"])
try:
    j = json.loads(pid)
    if j.get("id"):
        results.append(("pixeldrain", f"https://pixeldrain.com/u/{j['id']}",
                        f"https://pixeldrain.com/api/file/{j['id']}?download"))
    else:
        print("pixeldrain failed:", pid[:200])
except Exception as e:
    print("pixeldrain failed:", e, "|", pid[:200])

# 4) litterbox (catbox anon) — 72h
up = run(["-F", "reqtype=fileupload", "-F", "time=72h", "-F", f"fileToUpload=@{VID}",
          "https://litterbox.catbox.moe/resources/internals/api.php"])
if up.strip().startswith("http"):
    results.append(("litterbox-72h", up.strip(), up.strip()))
else:
    print("litterbox failed:", up[:200])

# 5) x0.at
up = run(["-F", f"file=@{VID}", "https://x0.at/"])
if up.strip().startswith("http"):
    results.append(("x0.at", up.strip(), up.strip()))
else:
    print("x0.at failed:", up[:200])

# 6) bashupload.com — 3 days
up = run(["-T", VID, f"https://bashupload.com/{NAME}"], timeout=600)
if "https://" in up:
    link = [l for l in up.split() if l.startswith("https://") and "bashupload" in l]
    if link:
        results.append(("bashupload-3d", link[0].strip(), link[0].strip()))
else:
    print("bashupload failed:", up[:200])

print("\n=== candidates ===")
for name, page, direct in results:
    print(f"{name}: page={page} direct={direct}")

# ── VERIFY: re-download, size+sha256 match, ffprobe duration ──
print("\n=== verification ===")
verified = []
for name, page, direct in results:
    try:
        out = f"/home/z/my-project/adwork/verify-video-{name}.mp4"
        run(["-o", out, direct], timeout=600)
        p = pathlib.Path(out)
        if p.exists() and p.stat().st_size == SIZE and sha(out) == SHA_LOCAL:
            pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                 "format=duration", "-of", "csv=p=0", out],
                                capture_output=True, text=True)
            dur = pr.stdout.strip()
            ok = dur.startswith("27.")
            print(f"VERIFIED {name}: size+sha256 match, duration={dur}s")
            if ok:
                verified.append((name, page, direct))
        else:
            print(f"VERIFY FAIL {name}: size={p.stat().st_size if p.exists() else 'missing'}")
    except Exception as e:
        print(f"VERIFY FAIL {name}: {e}")

print("\n=== FINAL ===")
for name, page, direct in verified:
    print(f"WORKING {name}: {page}" + (f"  (direct: {direct})" if direct != page else ""))
if not verified:
    sys.exit(1)
