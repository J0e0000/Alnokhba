#!/usr/bin/env python3
"""State check Nov 3: live deploy fingerprints + DB migration/RLS state.
Reads secrets from .secrets/alnokhba-db.env, never prints them."""
import json, os, re, sys, urllib.request, ssl

ENV = {}
with open('/home/z/my-project/.secrets/alnokhba-db.env') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            ENV[k.strip()] = v.strip().strip('"').strip("'")

SB_URL = ENV.get('SUPABASE_URL') or ENV.get('NEXT_PUBLIC_SUPABASE_URL')
ANON = ENV.get('SUPABASE_ANON_KEY') or ENV.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
SVC = ENV.get('SUPABASE_SERVICE_ROLE_KEY') or ENV.get('SUPABASE_SECRET_KEY')
SB_REF = SB_URL.split('//')[1].split('.')[0] if SB_URL else '?'

print(f"SB ref: {SB_REF[:8]}...  anon:{'yes' if ANON else 'NO'}  svc:{'yes' if SVC else 'NO'}")

ctx = ssl.create_default_context()

# ── 1) LIVE DEPLOY FINGERPRINTS ─────────────────────────────────────────────
def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        return r.read().decode('utf-8', 'replace'), dict(r.headers)

print("\n== LIVE DEPLOY ==")
html, hdrs = fetch('https://al-nokhbba.vercel.app/')
m = re.search(r'src="(/app-v2/index-[^"]+\.js)"', html)
print(f"entry chunk: {m.group(1) if m else 'NOT FOUND /app-v2 index'}")
if m:
    entry, _ = fetch('https://al-nokhbba.vercel.app' + m.group(1))
    for name, pat in [
        ('pricing 500 EGP', '500'),
        ('pricing plan label', 'اشتراك'),
        ('any-students wording', 'عدد'),
    ]:
        print(f"  entry has {name!r}: {pat in entry}")
    # scan all chunk names from entry for lazy chunks
    chunks = sorted(set(re.findall(r'([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js)', entry)))
    print(f"  referenced chunk names in entry: {len(chunks)}")

# portal page: PublicQRPage is likely its own chunk loaded on /s/:token routes; grep all app-v2 chunks via manifest approach:
# simpler: probe a few known chunk name patterns from the entry's import map
if m:
    entry, _ = fetch('https://al-nokhbba.vercel.app' + m.group(1))
    mods = sorted(set(re.findall(r'from"\./([^"]+\.js)"|import\("\./([^"]+\.js)"\)', entry)))
    flat = sorted({a or b for a, b in mods})
    print(f"  dynamic/static imports: {len(flat)}")
    hits = {}
    for c in flat:
        try:
            body, _ = fetch('https://al-nokhbba.vercel.app/app-v2/' + c)
        except Exception:
            continue
        for name, pat in [
            ('PORTAL- TABLE محاضرات مرحلتك', 'محاضرات مرحلتك'),
            ('PORTAL rpc get_student_stage_schedule', 'get_student_stage_schedule'),
            ('PRICING unified 500', '"500"'),
            ('PRICING label شهري', 'شهري'),
        ]:
            if pat in body:
                hits.setdefault(name, []).append(c)
    for k, v in hits.items():
        print(f"  {k}: {v[:3]}{'…' if len(v) > 3 else ''}")
    if not any('PORTAL' in k for k in hits):
        print("  !! NO portal-table fingerprint found in any imported chunk")

# ── 2) DB STATE (service role; read-only checks) ────────────────────────────
print("\n== DB STATE ==")
def sql(query, use_svc=True):
    key = SVC if use_svc else ANON
    req = urllib.request.Request(
        f'https://{SB_REF.split("//")[0] if "//" in SB_REF else SB_REF}.supabase.co/rest/v1/rpc/exec_sql'
    )  # placeholder; real query below
    return None

# Use PostgREST direct checks instead:
def pg_rest(table, query_params, key, method='GET'):
    url = f"{SB_URL}/rest/v1/{table}?{query_params}"
    req = urllib.request.Request(url, method=method, headers={
        'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return r.status, r.read().decode('utf-8', 'replace')[:400]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')[:400]

# anon probe: can anon still list student_qr_tokens? (should be blocked after 061)
st, body = pg_rest('student_qr_tokens', 'select=token&limit=3', ANON)
print(f"anon read student_qr_tokens -> HTTP {st} {'(LEAK!)' if st == 200 else '(blocked, good)'}")
print(f"  body: {body[:160]}")

# Management API: list applied migrations
AT = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{SB_REF}/database/migrations',
                             headers={'Authorization': f'Bearer {AT}'})
try:
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        mig = json.loads(r.read().decode())
        names = [x.get('name') or x.get('version') for x in mig]
        print(f"\napplied migrations: {len(names)}")
        tail = [n for n in names if any(f'06{i}' in str(n) or f'05{i}' in str(n) for i in range(5, 10))]
        print(f"  05x/06x tail: {sorted(tail)[-12:]}")
except urllib.error.HTTPError as e:
    print(f"Management API migrations: HTTP {e.code}: {e.read().decode()[:200]}")
