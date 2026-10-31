#!/usr/bin/env python3
"""Task 38 — apply the pending migration bundle to PRODUCTION Supabase via the
Management API, then verify every object exists (pg catalogs). Never prints
the token. Bundle is idempotent — safe to re-run on partial failure."""
import json, sys, urllib.request, urllib.error

BASE = 'https://api.supabase.com/v1'
REF = 'pbsythpzncjoafpmijyd'
BUNDLE = '/home/z/my-project/supabase/APPLY-ALL-049-050-051-052.sql'


def api(method, path, body=None, timeout=300):
    tok = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        'authorization': f'Bearer {tok}', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:800]


def sql(query, timeout=300):
    return api('POST', f'/projects/{REF}/database/query', {'query': query}, timeout)


def main():
    # 1) token + project access
    st, proj = api('GET', f'/projects/{REF}')
    if st != 200:
        print('TOKEN/PROJECT CHECK FAILED:', st, json.dumps(proj)[:300]); sys.exit(1)
    print(f"project OK: {proj.get('name')} | region: {proj.get('region')} | status: {proj.get('status')}")

    # 2) current edge functions config (record verify_jwt for later redeploy)
    st, fns = api('GET', f'/projects/{REF}/functions')
    if st == 200:
        for f in fns:
            upd = f.get('updated_at', '?')
            upd = str(upd)[:19]
            print(f"function: {f.get('slug')} | verify_jwt: {f.get('verify_jwt')} | status: {f.get('status')} | updated: {upd}")

    # 3) apply bundle
    bundle = open(BUNDLE, encoding='utf-8').read()
    print(f'\nbundle: {len(bundle)} chars, {bundle.count(chr(10))} lines -> applying ...')
    st, res = sql(bundle)
    if st in (200, 201):
        rows = json.dumps(res, ensure_ascii=False)
        print(f'APPLY OK ({st}). result:', (rows[:400] if rows and rows != 'null' else 'no rows'))
    else:
        print('APPLY FAILED:', st, json.dumps(res, ensure_ascii=False)[:600])
        sys.exit(2)

    # 4) verify objects via pg catalogs
    checks = {
        "tables": ["edge_rate_limits", "centers", "center_members", "standalone_exams",
                   "standalone_exam_scores", "subscription_renewals", "admin_audit_logs"],
        "rpcs": ["admin_log_audit", "consume_rate_limit", "create_center",
                 "get_student_standalone_exams", "admin_restore_apply"],
    }
    for kind, names in checks.items():
        st, res = sql(
            "select string_agg(p, ',') from unnest(ARRAY[%s]) p(p) "
            "where not exists (select 1 from pg_proc pp join pg_namespace n on n.oid=pp.pronamespace "
            "where n.nspname='public' and pp.proname=p)" % ",".join(f"'{n}'" for n in names)
        ) if kind == 'rpcs' else sql(
            "select string_agg(p, ',') from unnest(ARRAY[%s]) p(p) "
            "where not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace "
            "where n.nspname='public' and c.relname=p)" % ",".join(f"'{n}'" for n in names)
        )
        if st in (200, 201) and isinstance(res, list) and res:
            first = res[0]
            missing = (list(first.values())[0] if isinstance(first, dict) else first[0]) or None
        else:
            missing = None if st in (200, 201) else f'HTTP {st}'
        print(f"{kind}: {'ALL PRESENT ✓' if not missing else 'MISSING -> ' + str(missing)}")


if __name__ == '__main__':
    main()
