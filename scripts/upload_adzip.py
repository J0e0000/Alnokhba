"""Upload the 16:9 ad zip to a cloud file host; verify link works (sha256 + zip integrity).
Round 2: more hosts, fixed gofile endpoint (GET /servers), browser UA."""
import subprocess, json, sys, pathlib, hashlib

ZIP = "/home/z/my-project/download/alnokhba-ad-screenshots-16x9.zip"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

SHA_LOCAL = sha(ZIP)
SIZE = pathlib.Path(ZIP).stat().st_size
print(f"local: {SIZE} bytes sha256={SHA_LOCAL[:16]}…")

def run(args, timeout=300, binary=False):
    r = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA] + args,
                       capture_output=True)
    return r.stdout if binary else r.stdout.decode(errors="replace")

results = []  # (name, page_link, direct_link_or_None)

# 1) gofile.io — GET /servers, then upload
srv = run(["-X", "GET", "https://api.gofile.io/servers"])
try:
    server = json.loads(srv)["data"]["servers"][0]["name"]
    up = run(["-F", f"file=@{ZIP}", f"https://{server}.gofile.io/contents/uploadfile"], timeout=600)
    j = json.loads(up)
    if j.get("status") == "ok":
        fid, fname = j["data"]["id"], j["data"]["name"]
        page = j["data"]["downloadPage"]
        direct = f"https://{server}.gofile.io/download/web/{fid}/{fname}"
        results.append(("gofile", page, direct))
    else:
        print("gofile upload failed:", up[:200])
except Exception as e:
    print("gofile failed:", e, "|", srv[:200])

# 2) litterbox (catbox anon) — 72h
up = run(["-F", "reqtype=fileupload", "-F", "time=72h", "-F", f"fileToUpload=@{ZIP}",
          "https://litterbox.catbox.moe/resources/internals/api.php"])
if up.strip().startswith("http"):
    results.append(("litterbox-72h", up.strip(), up.strip()))
else:
    print("litterbox failed:", up[:200])

# 3) pixeldrain — anonymous PUT
pid = run(["-T", ZIP, "--upload-file", f"https://pixeldrain.com/api/file/alnokhba-ad-screenshots-16x9.zip"])
try:
    j = json.loads(pid)
    if j.get("id"):
        results.append(("pixeldrain", f"https://pixeldrain.com/u/{j['id']}",
                        f"https://pixeldrain.com/api/file/{j['id']}?download"))
    else:
        print("pixeldrain failed:", pid[:200])
except Exception as e:
    print("pixeldrain failed:", e, "|", pid[:200])

# 4) x0.at
up = run(["-F", f"file=@{ZIP}", "https://x0.at/"])
if up.strip().startswith("http"):
    results.append(("x0.at", up.strip(), up.strip()))
else:
    print("x0.at failed:", up[:200])

# 5) file.io — 100 downloads cap, no autodelete
up = run(["-F", f"file=@{ZIP}", "https://file.io/?maxDownloads=100&autoDelete=false"])
try:
    j = json.loads(up)
    if j.get("success"):
        results.append(("file.io", j["link"], j["link"]))
    else:
        print("file.io failed:", up[:200])
except Exception as e:
    print("file.io failed:", e, "|", up[:200])

# 6) bashupload.com — 3 days
up = run(["-T", ZIP, "https://bashupload.com/alnokhba-ad-screenshots-16x9.zip"], timeout=600)
if "https://" in up:
    link = [l for l in up.split() if l.startswith("https://") and "bashupload" in l]
    if link:
        results.append(("bashupload-3d", link[0].strip(), link[0].strip()))
else:
    print("bashupload failed:", up[:200])

print("\n=== candidates ===")
for name, page, direct in results:
    print(f"{name}: page={page} direct={direct}")

# ── VERIFY: download each direct link back, compare sha256, test zip integrity ──
print("\n=== verification ===")
verified = []
for name, page, direct in results:
    try:
        out = f"/home/z/my-project/adwork/verify-{name}.zip"
        run(["-o", out, direct], timeout=600, binary=False)
        p = pathlib.Path(out)
        if p.exists() and p.stat().st_size == SIZE and sha(out) == SHA_LOCAL:
            t = subprocess.run(["unzip", "-t", out], capture_output=True, text=True)
            ok = "No errors detected" in t.stdout
            print(f"VERIFIED {name}: size+sha256 match, zip integrity {'OK' if ok else 'FAIL'}")
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
