#!/usr/bin/env python3
"""Task 37 probe — which migrations are applied on the LIVE Supabase project?
Extracts the PUBLIC anon key from the live bundle (ships to every browser by
design; never printed) and probes REST objects that each migration creates.

Object map:
  migration_048  -> table subscription_renewals
  migration_049  -> table admin_audit_logs (+ edge_rate_limits)
  migration_050  -> table centers
  migration_051  -> table standalone_exams
PostgREST semantics (anon key, RLS on):
  table exists      -> 200 [] or 401/403 (rls denial) — never PGRST205
  table missing     -> 404 PGRST205 "Could not find the table ... schema cache"
"""
import re
import urllib.request

SITE = 'https://al-nokhbba.vercel.app'


def get_text(url):
    req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


def rest(base, key, path, method='GET', body=None):
    data = None if body is None else body.encode()
    req = urllib.request.Request(base + path, data=data, method=method, headers={
        'apikey': key, 'authorization': f'Bearer {key}',
        'content-type': 'application/json', 'user-agent': 'Mozilla/5.0',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def main():
    html = get_text(SITE + '/')
    entry = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
    js = get_text(SITE + entry.group(1))
    chunk = re.search(r'(assets/supabaseClient-[\w-]+\.js)', js)
    client = get_text(SITE + '/' + chunk.group(1))
    base = re.search(r'https://[a-z0-9-]+\.supabase\.co', client).group(0)
    key = re.search(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', client).group(0)
    print('project:', base.split('//')[1].split('.')[0], '| anon key:', len(key), 'chars (not printed)')

    checks = [
        ('subscription_renewals (m048)', '/rest/v1/subscription_renewals?select=id&limit=1'),
        ('admin_audit_logs (m049)', '/rest/v1/admin_audit_logs?select=id&limit=1'),
        ('edge_rate_limits (m049)', '/rest/v1/edge_rate_limits?select=id&limit=1'),
        ('centers (m050)', '/rest/v1/centers?select=id&limit=1'),
        ('center_members (m050)', '/rest/v1/center_members?select=id&limit=1'),
        ('standalone_exams (m051)', '/rest/v1/standalone_exams?select=id&limit=1'),
        ('standalone_exam_scores (m051)', '/rest/v1/standalone_exam_scores?select=id&limit=1'),
        ('students sanity (pre-030)', '/rest/v1/students?select=id&limit=1'),
    ]
    missing = []
    for label, path in checks:
        status, body = rest(base, key, path)
        missing_table = 'PGRST205' in body or 'Could not find the table' in body
        state = 'MISSING' if missing_table else ('exists' if status in (200, 401, 403) else f'?{status}')
        if missing_table:
            missing.append(label.split(' ')[0])
        print(f"  [{label}] HTTP {status} -> {state}")
        if state not in ('exists', 'MISSING'):
            print('     body:', body)

    # RPC probes
    for fn, args in [
        ('admin_log_audit (m049)', {'p_action': 'probe', 'p_entity': 'probe', 'p_entity_id': None}),
        ('consume_rate_limit (m049)', {'p_key': 'probe', 'p_limit': 1, 'p_window_seconds': 1}),
        ('get_student_portal (legacy check)', {}),
    ]:
        status, body = rest(base, key, '/rest/v1/rpc/' + fn.split(' ')[0], 'POST', '{"__probe__":"1"}')
        miss = 'PGRST202' in body or 'Could not find the function' in body or 'schema_cache' in body
        print(f"  [{fn}] HTTP {status} -> {'MISSING' if miss else 'present/denied'}")

    print('RESULT:', 'MISSING TABLES:' if missing else 'all tables present',
          ','.join(missing) if missing else '(migrations applied)')


if __name__ == '__main__':
    main()
