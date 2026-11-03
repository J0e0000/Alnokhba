#!/usr/bin/env python3
"""Verify live deployment vs local build + probe prod DB (pbsyth) via anon key from live chunks."""
import glob, os, re, ssl, urllib.request, urllib.error

ctx = ssl.create_default_context()
def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read().decode('utf-8', 'replace')

BASE = 'https://al-nokhbba.vercel.app'
local = {}
for p in glob.glob('/home/z/my-project/frontend/dist/app-v2/*.js'):
    local[os.path.basename(p)] = open(p, encoding='utf-8', errors='replace').read()
print(f"local chunks: {len(local)}")

html = fetch(BASE + '/', timeout=30)
entry = re.search(r'src="(/app-v2/index-[^"]+\.js)"', html).group(1)
print(f"live entry: {entry}  local-entry-same: {os.path.basename(entry) in local}")

# fetch ALL local chunk names from live CDN: count how many exist (deployment completeness)
ok = miss = 0
missing = []
for name in local:
    try:
        fetch(f'{BASE}/app-v2/{name}', timeout=15)
        ok += 1
    except urllib.error.HTTPError:
        miss += 1
        missing.append(name)
print(f"live has {ok}/{len(local)} chunks; missing: {missing[:5]}")

# fingerprints in the LIVE PublicQRPage chunk
try:
    body = fetch(f'{BASE}/app-v2/PublicQRPage-J60A5wC2.js', timeout=20)
    for name, pat in [('جدول محاضرات المرحلة section', 'محاضرات مرحلتك'),
                      ('rpc name', 'get_student_stage_schedule'),
                      ('today badge', 'النهاردة')]:
        print(f"  LIVE PublicQRPage has {name!r}: {pat in body}")
except urllib.error.HTTPError as e:
    print(f"live PublicQRPage: HTTP {e.code}")

# extract anon key + supabase ref from live chunks
ref, anon = None, None
for name, body in local.items():
    m = re.search(r'https://([a-z0-9]{20})\.supabase\.co', body)
    if m and not ref:
        ref = m.group(1)
    k = re.search(r'eyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}', body)
    if k and not anon:
        anon = k.group(0)
    if ref and anon:
        break
print(f"\nlocal-bundle supabase ref: {ref}  anon: {'found len=' + str(len(anon)) if anon else 'NOT FOUND'}")
with open('/tmp/anonkey.txt', 'w') as f:
    f.write(anon or '')
os.chmod('/tmp/anonkey.txt', 0o600)

# probe RPC existence on production ref
def probe_rpc(fn, payload=b'{}'):
    url = f'https://{ref}.supabase.co/rest/v1/rpc/{fn}'
    req = urllib.request.Request(url, method='POST', headers={
        'apikey': anon, 'Authorization': f'Bearer {anon}', 'Content-Type': 'application/json'}, data=payload)
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return r.status, r.read().decode()[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

for fn in ['get_student_stage_schedule', 'get_student_portal_data']:
    st, body = probe_rpc(fn)
    print(f"anon rpc {fn} @ {ref}: HTTP {st} -> {body[:220]}")

# QR tokens leak check on production
url = f'https://{ref}.supabase.co/rest/v1/student_qr_tokens?select=token&limit=3'
req = urllib.request.Request(url, headers={'apikey': anon, 'Authorization': f'Bearer {anon}'})
try:
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        print(f"anon read student_qr_tokens: HTTP {r.status} (LEAK!) {r.read().decode()[:150]}")
except urllib.error.HTTPError as e:
    print(f"anon read student_qr_tokens: HTTP {e.code} (blocked, good)")
