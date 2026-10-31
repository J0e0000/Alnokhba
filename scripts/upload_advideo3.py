"""Round 3: retry durable hosts (x0.at 30d+, file.io no-autodelete, oshi.at, litterbox, bashupload)
and verify by re-download (size+sha256+ffprobe).
"""
import subprocess, json, sys, pathlib, hashlib

VID = "/home/z/my-project/download/alnokhba-ad-video-16x9.mp4"
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

def run(args, timeout=420, binary=False):
    r = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA] + args,
                       capture_output=True)
    return r.stdout if binary else r.stdout.decode(errors="replace")

results = []

# 1) x0.at — retention ~30+ days at this size
up = run(["-F", f"file=@{VID}", "https://x0.at/"])
if up.strip().startswith("http"):
    results.append(("x0-30d", up.strip(), up.strip()))
else:
    print("x0 failed:", up[:150])

# 2) file.io — persists until 100 downloads, no autodelete
up = run(["-F", f"file=@{VID}", "https://file.io/?maxDownloads=100&autoDelete=false"])
try:
    j = json.loads(up)
    if j.get("success"):
        results.append(("fileio-100dl", j["link"], j["link"]))
    else:
        print("file.io failed:", up[:150])
except Exception as e:
    print("file.io failed:", e, "|", up[:150])

# 3) oshi.at — default 30 days
up = run(["-F", f"file=@{VID}", "https://oshi.at"])
if "https://" in up:
    link = [l.strip() for l in up.split() if l.strip().startswith("https://")]
    if link:
        results.append(("oshi-30d", link[0], link[0]))
else:
    print("oshi failed:", up[:150])

# 4) litterbox 72h retry
up = run(["-F", "reqtype=fileupload", "-F", "time=72h", "-F", f"fileToUpload=@{VID}",
          "https://litterbox.catbox.moe/resources/internals/api.php"])
if up.strip().startswith("http"):
    results.append(("litterbox-72h", up.strip(), up.strip()))
else:
    print("litterbox failed:", up[:150])

# 5) bashupload retry (3 days)
up = run(["-T", VID, "https://bashupload.com/alnokhba-ad-video-16x9.mp4"])
if "https://" in up:
    link = [l.strip() for l in up.split() if l.strip().startswith("https://") and "bashupload" in l]
    if link:
        results.append(("bashupload-3d", link[0], link[0]))
else:
    print("bashupload failed:", up[:150])

print("\n=== candidates ===")
for name, page, direct in results:
    print(f"{name}: {page}")

print("\n=== verification ===")
verified = []
for name, page, direct in results:
    try:
        out = f"/home/z/my-project/adwork/v3-{name}.mp4"
        run(["-o", out, direct], timeout=420)
        p = pathlib.Path(out)
        if p.exists() and p.stat().st_size == SIZE and sha(out) == SHA_LOCAL:
            pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                 "format=duration", "-of", "csv=p=0", out],
                                capture_output=True, text=True)
            print(f"VERIFIED {name}: sha256 match, duration={pr.stdout.strip()}s")
            verified.append((name, page, direct))
        else:
            head = open(out, "rb").read(80)[:80] if p.exists() else b"missing"
            print(f"VERIFY FAIL {name}: size={p.stat().st_size if p.exists() else 0} head={head!r}")
    except Exception as e:
        print(f"VERIFY FAIL {name}: {e}")

print("\n=== FINAL ===")
for name, page, direct in verified:
    print(f"WORKING {name}: {page}")
if not verified:
    sys.exit(1)
