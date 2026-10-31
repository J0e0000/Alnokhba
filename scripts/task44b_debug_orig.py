#!/usr/bin/env python3
"""Was the ORIGINAL get_student_portal_data broken before our rewrite?
Creates a temp function with the original text and runs it."""
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
        return e.code, e.read().decode()[:500]

orig = open('/home/z/my-project/scripts/task44b_portal_rpc_current.sql').read()
test_fn = orig.replace('get_student_portal_data(p_token text)',
                       'get_student_portal_data_origtest(p_token text)')
s, r = q(test_fn)
print('create orig-test:', s, str(r)[:200] if s != 201 else 'OK')

s, r = q("select token from student_qr_tokens where student_id='90ed4ddb-cf71-4828-9f0e-5b5ca2f3bcde' and revoked_at is null limit 1")
token = r[0]['token']
s, r = q(f"select get_student_portal_data_origtest('{token}') d")
print('run orig-test:', s, 'rows' if s == 201 else str(r)[:400])

q('drop function if exists public.get_student_portal_data_origtest(text)')
print('dropped test fn')
