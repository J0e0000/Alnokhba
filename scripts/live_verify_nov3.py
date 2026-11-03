#!/usr/bin/env python3
"""Wait for deploy of 048eeaa8 then verify live: CSP, boot files, portal table, pricing."""
import json, re, ssl, time, urllib.request, urllib.error

REF_GH = 'J0e0000/Alnokhba'
COMMIT = '048eeaa8'
BASE = 'https://al-nokhbba.vercel.app'
ctx = ssl.create_default_context()

def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers)

# GitHub token from remote URL
remote = urllib.request.urlopen(urllib.request.Request('file:///dev/null')).read() if False else None
import subprocess
remote = subprocess.run(['git', '-C', '/home/z/my-project', 'remote', 'get-url', 'origin'],
                        capture_output=True, text=True).stdout.strip()
gh = re.search(r'oauth2:([^@]+)@', remote).group(1)

# 1) wait for deploy status
print(f"waiting for Vercel deploy of {COMMIT}…")
deadline = time.time() + 600
state = None
while time.time() < deadline:
    req = urllib.request.Request(
        f'https://api.github.com/repos/{REF_GH}/commits/{COMMIT}/status',
        headers={'Authorization': f'token {gh}', 'Accept': 'application/vnd.github+json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
            state = data.get('state')
            if state in ('success', 'failure', 'error'):
                print(f"  deploy state: {state}")
                break
    except Exception as e:
        print(f"  status check: {e}")
    time.sleep(20)
if state != 'success':
    raise SystemExit(f'deploy did not succeed: {state}')

# 2) CSP header live
st, html, hdrs = fetch(BASE + '/')
csp = hdrs.get('Content-Security-Policy') or hdrs.get('content-security-policy') or ''
script_part = csp.split('style-src')[0] if 'style-src' in csp else csp
print(f"\nCSP live: strict-script={'script-src' in csp and 'self' in script_part} unsafe-inline-in-script-src={'unsafe-inline' in script_part}")
entry = re.search(r'src="(/app-v2/index-[^"]+\.js)"', html)
print(f"entry: {entry.group(1) if entry else 'NOT FOUND'}")

# 3) boot files live
for f in ['storage-gen.js', 'diag-engine.js', 'ios-shims.js', 'prerender-fastpath.js']:
    try:
        st, body, _ = fetch(f'{BASE}/boot/{f}', timeout=15)
        ok = st == 200 and len(body) > 400
        print(f"/boot/{f}: HTTP {st} len={len(body)} {'OK' if ok else 'PROBLEM'}")
    except urllib.error.HTTPError as e:
        print(f"/boot/{f}: HTTP {e.code} MISSING!")

# 4) diag.html must NOT be the diagnostic page anymore
try:
    st, body, _ = fetch(f'{BASE}/diag.html', timeout=15)
    is_diag = 'تشخيص النخبة' in body and 'nk-diag' in body
    print(f"/diag.html: HTTP {st} diag-content={is_diag} (should be False — SPA shell or 404)")
except urllib.error.HTTPError as e:
    print(f"/diag.html: HTTP {e.code} (gone)")

# 5) entry + portal chunk fingerprints
st, ebody, _ = fetch(BASE + (entry.group(1) if entry else ''))
print(f"entry has 500-pricing: {'500' in ebody and 'اشتراك' in ebody}")
# find PublicQRPage chunk via app graph — it's lazy; probe known built name from local dist
import glob, os
local = {os.path.basename(p) for p in glob.glob('/home/z/my-project/frontend/dist/app-v2/*.js')}
portal_hits = []
for name in local:
    if 'PublicQRPage' not in name:
        continue
    try:
        st, body, _ = fetch(f'{BASE}/app-v2/{name}', timeout=20)
        portal_hits.append((name, 'محاضرات مرحلتك' in body or 'جدول محاضرات' in body, 'get_student_stage_schedule' in body, st))
    except urllib.error.HTTPError as e:
        portal_hits.append((name, False, False, e.code))
for name, has_table, has_rpc, st in portal_hits:
    print(f"portal chunk {name}: HTTP {st} table={has_table} rpc={has_rpc}")

# 6) grab a real portal token for browser verification (read-only)
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
req = urllib.request.Request('https://api.supabase.com/v1/projects/pbsythpzncjoafpmijyd/database/query',
    method='POST', headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
    data=json.dumps({'query': "select q.token, s.name, s.stage from student_qr_tokens q join students s on s.id=q.student_id where q.revoked_at is null and coalesce(s.stage,'')<>'' and exists(select 1 from group_schedule gs where gs.teacher_id=s.teacher_id) limit 1"}).encode())
with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
    row = json.loads(r.read().decode())[0]
open('/tmp/portal_url.txt', 'w').write(f"{BASE}/qr/{row['token']}")
print(f"\nportal test URL ready for {row['name']!r} (stage={row['stage']!r}) → /tmp/portal_url.txt")
