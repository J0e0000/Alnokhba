#!/usr/bin/env python3
"""Debug: single save_standalone_score call with injected claims."""
import json, urllib.request, uuid as u

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

T = '7a7e85ed-29a9-48f0-829f-08318c395394'
S = '8001ece3-4728-467d-9a23-2b6537649b13'
E = str(u.uuid4())
sections = json.dumps([{'name': 'أ', 'max': 20}, {'name': 'ب', 'max': 30}], ensure_ascii=False)

s, r = q(f"insert into standalone_exams (id, teacher_id, title, max_score, sections) values ('{E}','{T}','فني',50,'{sections}'::jsonb) returning id")
print('create:', s, str(r)[:200])

claims = '{"sub":"' + T + '","role":"authenticated"}'
s, r = q("select set_config('request.jwt.claims', '%s', true);\nselect save_standalone_score('%s','%s', null, '[15, null]'::jsonb, null, 'فني') d;" % (claims, E, S))
print('save:', s, str(r)[:500])

q(f"delete from standalone_exams where id='{E}'")
print('cleaned')
