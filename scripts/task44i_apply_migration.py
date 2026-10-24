#!/usr/bin/env python3
"""Task 44i — apply migration_059_teacher_notif_hygiene.sql to PROD, then verify."""
import json, sys, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
SQL_PATH = '/home/z/my-project/supabase/migration_059_teacher_notif_hygiene.sql'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:600]}') from e

def main():
    sql = open(SQL_PATH).read()
    # strip comment-only lines? not needed — pg-meta executes the whole script.
    print('applying migration_059 ...', flush=True)
    res = q(sql)
    print('result:', json.dumps(res, ensure_ascii=False)[:300], flush=True)

    # verify
    print('--- verify bridge skip ---', flush=True)
    print(json.dumps(q("select pg_get_functiondef(oid) from pg_proc where proname='bridge_student_notification_to_teacher_push'"), ensure_ascii=False)[:700], flush=True)
    print('--- verify rpc exists ---', flush=True)
    print(json.dumps(q("select proname from pg_proc where proname='mark_teacher_events_read'"), ensure_ascii=False), flush=True)
    print('--- verify cleanup + totals ---', flush=True)
    print(json.dumps(q("select count(*) total, count(*) filter (where not is_read) unread, min(created_at) oldest from teacher_notification_events"), ensure_ascii=False), flush=True)
    print('MIGRATION 059 OK', flush=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('FAILED:', e, flush=True)
        sys.exit(1)
