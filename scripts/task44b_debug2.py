#!/usr/bin/env python3
"""Debug: portal RPC error + leftover exams."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
URL = 'https://api.supabase.com/v1/projects/pbsythpzncjoafpmijyd/database/query'

def q(sql):
    req = urllib.request.Request(URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]

# 1) leftover exams anywhere
s, r = q("select id, teacher_id, title, status from standalone_exams where title like '%فني%'")
print('LEFTOVERS:', s, json.dumps(r, ensure_ascii=False)[:400])

# 2) try the delete explicitly
s, r = q("delete from standalone_exams where title in ('اختبار فني 056','اختبار فني معدل') returning id")
print('DELETE:', s, str(r)[:200])

# 3) portal RPC with the real token — see the actual error
s, r = q("select token from student_qr_tokens where student_id='90ed4ddb-cf71-4828-9f0e-5b5ca2f3bcde' and revoked_at is null limit 1")
token = r[0]['token']
s, r = q(f"select get_student_portal_data('{token}') d")
print('PORTAL:', s, str(r)[:600])
