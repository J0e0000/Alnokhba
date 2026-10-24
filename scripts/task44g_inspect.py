#!/usr/bin/env python3
"""Task 44g — inspect RPCs & columns: start_online_exam resume behavior, portal data token matching, tokens."""
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

def show(label, sql, limit=3000):
    try:
        print(f'--- {label} ---', flush=True)
        print(json.dumps(q(sql), ensure_ascii=False)[:limit], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

# 1) start_online_exam — full definition (resume: does it return saved answers?)
show('start_online_exam', "select pg_get_functiondef('public.start_online_exam(text,uuid)'::regprocedure) as def", 9000)

# 2) get_student_portal_data — how p_token is matched (any slash handling?)
show('portal_data_head', "select pg_get_functiondef('public.get_student_portal_data(text)'::regprocedure) as def", 9000)
