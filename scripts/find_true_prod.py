#!/usr/bin/env python3
"""Identify TRUE production supabase project from live JS + check token's project access."""
import json, re, ssl, urllib.request, urllib.error

ENV = {}
with open('/home/z/my-project/.secrets/alnokhba-db.env') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            ENV[k.strip()] = v.strip().strip('"').strip("'")

env_url = ENV.get('SUPABASE_URL') or ENV.get('NEXT_PUBLIC_SUPABASE_URL')
env_anon = ENV.get('SUPABASE_ANON_KEY') or ENV.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
print(f"env SUPABASE_URL ref: {env_url.split('//')[1].split('.')[0] if env_url else '?'}")
print(f"env anon key prefix: {env_anon[:12]}... len={len(env_anon)}")
print(f"env POSTGRES_HOST: {ENV.get('POSTGRES_HOST','?')[:40]}")

ctx = ssl.create_default_context()
def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.read().decode('utf-8', 'replace')

# 1) from live site: find supabase URL + anon key inside JS chunks
html = fetch('https://al-nokhbba.vercel.app/')
entry = re.search(r'src="(/app-v2/index-[^"]+\.js)"', html)
ebody = fetch('https://al-nokhbba.vercel.app' + entry.group(1))
urls = sorted(set(re.findall(r'https://([a-z0-9]{20})\.supabase\.co', ebody)))
keys = sorted(set(re.findall(r'eyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}', ebody)))
print(f"\nLIVE entry supabase refs: {urls}")
print(f"LIVE entry anon-like JWTs: {[k[:16] + '…' for k in keys]}")
live_ref = urls[0] if urls else '?'
same_anon = bool(keys) and keys[0][:40] == (env_anon[:40] if env_anon else '')
print(f"live anon == env anon: {same_anon}")

# 2) management API: what projects can the sbp token see?
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
req = urllib.request.Request('https://api.supabase.com/v1/projects', headers={'Authorization': f'Bearer {AT}'})
try:
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        projs = json.loads(r.read().decode())
        for p in projs:
            print(f"TOKEN-ACCESSIBLE project: {p['id']}  name={p.get('name')!r}  region={p.get('region')}  status={p.get('status')}")
except urllib.error.HTTPError as e:
    print(f"list projects: HTTP {e.code}: {e.read().decode()[:200]}")

# 3) anon-key probe against BOTH candidate refs: does get_student_stage_schedule exist?
def probe_rpc(ref, key, fn='get_student_stage_schedule'):
    url = f"https://{ref}.supabase.co/rest/v1/rpc/{fn}"
    req = urllib.request.Request(url, method='POST', headers={
        'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}, data=b'{}')
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

for ref, key in [(live_ref, keys[0] if keys else env_anon), (env_url.split('//')[1].split('.')[0] if env_url else '', env_anon)]:
    if not ref or not key:
        continue
    st, body = probe_rpc(ref, key)
    print(f"\nrpc get_student_stage_schedule @ {ref}: HTTP {st} -> {body[:180]}")
