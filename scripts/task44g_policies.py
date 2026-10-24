#!/usr/bin/env python3
"""Task 44g — verify: student_qr_tokens RLS (teacher bulk read), token coverage, insert policy."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def show(label, sql, limit=2500):
    try:
        print(f'--- {label} ---', flush=True)
        print(json.dumps(q(sql), ensure_ascii=False)[:limit], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('qr_token_policies', "select policyname, cmd, qual, with_check from pg_policies where tablename='student_qr_tokens'")
show('notif_insert_policy', "select policyname, cmd, with_check from pg_policies where tablename='student_notifications'")
show('token_coverage', "select count(distinct student_id) with_token from student_qr_tokens where revoked_at is null")
show('students_total', "select count(*) total, count(*) filter (where archived_at is null) active from students")
