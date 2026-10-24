#!/usr/bin/env python3
"""Task 44j — apply migration 060 (admin_email_config) + deploy admin-account-actions edge function.
Run AFTER reviewing SQL. Migration is idempotent; deploy replaces the function wholesale.
"""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def api(method, path, payload=None, timeout=180):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/{path}',
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:600]}') from e

def main():
    # 1) migration 060
    sql = open('/home/z/my-project/supabase/migration_060_admin_email_config.sql').read()
    st, out = api('POST', 'database/query', {'query': sql}, timeout=120)
    print('migration 060:', st, out[:300], flush=True)
    assert st in (200, 201), 'migration failed'

    # verify table + deny-all RLS
    st, out = api('POST', 'database/query', {'query': """
      select count(*) n, (select count(*) from pg_policies where tablename='admin_email_config') pol
      from information_schema.tables where table_schema='public' and table_name='admin_email_config'
    """}, timeout=60)
    print('verify table:', out, flush=True)

    # 2) deploy edge function
    src = open('/home/z/my-project/supabase/functions/admin-account-actions/index.ts').read()
    for marker in ('renew_team_subscription', 'set_email_config', 'send_test_email', 'get_email_config', 'admin_email_config'):
        assert marker in src, f'missing marker {marker}'
    body = {
        'entrypoint_path': 'index.ts',
        'name': 'admin-account-actions',
        'verify_jwt': True,
        'files': [{'name': 'index.ts', 'content': src}],
    }
    # مسار JSON المجرب: body = المصدر كامل (نقطة الـ create/update القديمة)
    try:
        st, out = api('PATCH', 'functions/admin-account-actions', {
            'verify_jwt': True,
            'body': src,
        }, timeout=180)
        print('patch deploy:', st, out[:300], flush=True)
    except RuntimeError as e:
        print('patch failed → delete+create fallback:', e, flush=True)
        try:
            api('DELETE', 'functions/admin-account-actions', timeout=60)
            print('old fn deleted', flush=True)
        except RuntimeError as e2:
            print('delete note:', e2, flush=True)
        st, out = api('POST', 'functions', {
            'slug': 'admin-account-actions',
            'name': 'admin-account-actions',
            'verify_jwt': True,
            'body': src,
        }, timeout=180)
        print('create deploy:', st, out[:300], flush=True)
    print('deploy:', st, out[:300], flush=True)
    assert st in (200, 201), 'deploy failed'
    print('ALL DONE', flush=True)

if __name__ == '__main__':
    main()
