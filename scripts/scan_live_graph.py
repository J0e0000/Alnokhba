#!/usr/bin/env python3
"""Scan LIVE entry import graph: find supabase ref+anon key, portal fingerprints, deployment currency."""
import re, ssl, urllib.request, urllib.error, json

ctx = ssl.create_default_context()
def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read().decode('utf-8', 'replace')

BASE = 'https://al-nokhbba.vercel.app'
html = fetch(BASE + '/')
entry = re.search(r'src="(/app-v2/index-[^"]+\.js)"', html).group(1)
print(f"entry: {entry}")
seen = {}
queue = [os.path.basename(entry) for os in [__import__('os')]]
seen[queue[0]] = fetch(f'{BASE}/app-v2/{queue[0]}')

# BFS the import graph (static + dynamic)
pat = re.compile(r'["\'](\.\/)?([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js)["\']')
while queue:
    cur = queue.pop(0)
    for _, name in pat.findall(seen[cur]):
        if name not in seen:
            try:
                seen[name] = fetch(f'{BASE}/app-v2/{name}')
                queue.append(name)
            except urllib.error.HTTPError:
                seen[name] = ''  # referenced but 404 (cross-build stale ref)
print(f"reachable chunks: {len(seen)} (empty/404: {sum(1 for v in seen.values() if not v)})")

ref = anon = None
for name, body in seen.items():
    if not body: continue
    m = re.search(r'https://([a-z0-9]{20})\.supabase\.co', body)
    if m and not ref: ref = m.group(1)
    k = re.search(r'eyJ[A-Za-z0-9_-]{100,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}', body)
    if k and not anon: anon = k.group(0)
print(f"prod ref: {ref}   anon: {'found len=' + str(len(anon)) if anon else 'NOT FOUND'}")

# fingerprints
for name, body in seen.items():
    if not body: continue
    tags = []
    if 'محاضرات مرحلتك' in body: tags.append('PORTAL-TABLE')
    if 'get_student_stage_schedule' in body: tags.append('RPC-NAME')
    if 'النهاردة' in body and 'PublicQRPage' in name: tags.append('TODAY-BADGE')
    if tags: print(f"  {name}: {tags}")

# save anon key
if anon:
    with open('/tmp/anonkey.txt', 'w') as f:
        f.write(anon)
    import os
    os.chmod('/tmp/anonkey.txt', 0o600)
    print("anon key saved to /tmp/anonkey.txt")
else:
    # fallback: dump first 3 chars pattern of any eyJ in entry for debugging
    e = seen.get(os.path.basename(entry), '')
    print("entry eyJ samples:", re.findall(r'eyJ[A-Za-z0-9_-]{10}', e)[:3])
