"""Round 2: upload MP4 to alternate hosts (filebin, 0x0.st, temp.sh, uguu, catbox retry)
and verify each link by re-downloading (size+sha256+ffprobe).
"""
import subprocess, json, sys, pathlib, hashlib, random, string

VID = "/home/z/my-project/download/alnokhba-ad-video-16x9.mp4"
NAME = "alnokhba-ad-video-16x9.mp4"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BIN = "alnokhba-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

SHA_LOCAL = sha(VID)
SIZE = pathlib.Path(VID).stat().st_size
print(f"local: {SIZE} bytes sha256={SHA_LOCAL[:16]}… bin={BIN}")

def run(args, timeout=300, binary=False):
    r = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA] + args,
                       capture_output=True)
    return r.stdout if binary else r.stdout.decode(errors="replace")

results = []

# 1) filebin.net — bin lives ~6 days, API GET downloads raw
up = run(["-X", "POST", "-H", "Content-Type: application/octet-stream",
          "--data-binary", f"@{VID}", f"https://filebin.net/{BIN}/{NAME}"], timeout=600)
if '"filename"' in up or '"ok":true' in up.lower():
    results.append(("filebin-6d", f"https://filebin.net/{BIN}/{NAME}",
                    f"https://filebin.net/{BIN}/{NAME}"))
else:
    print("filebin failed:", up[:200])

# 2) 0x0.st — min 30 days retention
up = run(["-F", f"file=@{VID}", "https://0x0.st"], timeout=600)
if up.strip().startswith("http"):
    results.append(("0x0-30d+", up.strip(), up.strip()))
else:
    print("0x0 failed:", up[:200])

# 3) temp.sh — 3 days
up = run(["-T", VID, f"https://temp.sh/{NAME}"], timeout=600)
if up.strip().startswith("http"):
    results.append(("tempsh-3d", up.strip(), up.strip()))
else:
    print("temp.sh failed:", up[:200])

# 4) uguu.se
up = run(["-F", f"files[]=@{VID}", "https://uguu.se/upload.php"], timeout=600)
try:
    j = json.loads(up)
    if j.get("success") and j.get("files"):
        results.append(("uguu", j["files"][0]["url"], j["files"][0]["url"]))
    else:
        print("uguu failed:", up[:200])
except Exception as e:
    print("uguu failed:", e, "|", up[:200])

# 5) catbox retry with userhash field
up = run(["-F", "reqtype=fileupload", "-F", "userhash=", "-F", f"fileToUpload=@{VID}",
          "https://catbox.moe/user/api.php"], timeout=600)
if up.strip().startswith("http"):
    results.append(("catbox-permanent", up.strip(), up.strip()))
else:
    print("catbox retry failed:", up[:200])

print("\n=== candidates ===")
for name, page, direct in results:
    print(f"{name}: {page}")

print("\n=== verification ===")
verified = []
for name, page, direct in results:
    try:
        out = f"/home/z/my-project/adwork/v2-{name}.mp4"
        run(["-o", out, "-H", "Accept: application/octet-stream", direct], timeout=600)
        p = pathlib.Path(out)
        if p.exists() and p.stat().st_size == SIZE and sha(out) == SHA_LOCAL:
            pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                 "format=duration", "-of", "csv=p=0", out],
                                capture_output=True, text=True)
            print(f"VERIFIED {name}: size+sha256 match, duration={pr.stdout.strip()}s")
            verified.append((name, page, direct))
        else:
            print(f"VERIFY FAIL {name}: size={p.stat().st_size if p.exists() else 'missing'} "
                  f"head={open(out,'rb').read(60)!r}" if p.exists() else f"VERIFY FAIL {name}: missing")
    except Exception as e:
        print(f"VERIFY FAIL {name}: {e}")

print("\n=== FINAL ===")
for name, page, direct in verified:
    print(f"WORKING {name}: {page}" + (f"  (direct: {direct})" if direct != page else ""))
if not verified:
    sys.exit(1)
