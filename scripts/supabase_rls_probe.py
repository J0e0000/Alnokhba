#!/usr/bin/env python3
"""Behavioral RLS probe: what can an ANON client actually read?

Reads the Supabase URL + anon key from a 0600 temp file (never printed),
then issues unauthenticated PostgREST GETs against the tables named in the
operator's note. Expected with RLS on: students / student_payments return
an empty array; student_qr_tokens (workspace-scoped after migration_042)
must NOT return token rows either.
"""
import base64, json, sys, urllib.request, urllib.error

ENV_FILE = '/tmp/.supabase_env'
raw = json.load(open(ENV_FILE))
url = raw['url'].rstrip('/')
key = raw['anon']

def probe(table):
    q = f"{url}/rest/v1/{table}?select=*&limit=3"
    req = urllib.request.Request(q, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', 'replace')
            rows = json.loads(body) if body.strip() else []
            cr = r.headers.get('content-range', 'n/a')
            print(f"{table}: HTTP {r.status}  content-range={cr}  rows_returned={len(rows)}")
            if rows:
                keys = sorted(rows[0].keys())[:6]
                print(f"  LEAK — first row keys: {keys}")
    except urllib.error.HTTPError as e:
        print(f"{table}: HTTP {e.code} {e.reason}  (blocked at API layer)")
    except Exception as e:
        print(f"{table}: ERROR {type(e).__name__}: {e}")

print(f"probing {url} as ANON (no login)")
for t in ['students', 'student_payments', 'student_qr_tokens', 'profiles']:
    probe(t)
