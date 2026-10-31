#!/usr/bin/env python3
"""Debug the resume path of start_online_exam."""
import json, urllib.request, urllib.error

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
URL = 'https://api.supabase.com/v1/projects/pbsythpzncjoafpmijyd/database/query'

def q(sql):
    req = urllib.request.Request(URL, data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

code, res = q("select s.id sid, t.token from student_qr_tokens t join students s on s.id=t.student_id where t.revoked_at is null limit 1")
sid, tok = res[0]['sid'], res[0]['token']
tid = q(f"select teacher_id from students where id='{sid}'")[1][0]['teacher_id']

QUESTIONS = json.dumps([
    {'text': 'Q1', 'choices': ['a', 'b', 'c', 'd'], 'correct': 0, 'marks': 5},
    {'text': 'Q2', 'choices': ['a', 'b'], 'correct': 1, 'marks': 5},
])
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'DBG-RESUME', null, 'open', 5, '{QUESTIONS}'::jsonb) returning id""")
exam_id = res[0]['id']
print('exam:', exam_id)

code, res = q(f"select start_online_exam('{tok}', '{exam_id}') r")
print('START1:', code, json.dumps(res)[:200])

code, res = q(f"select start_online_exam('{tok}', '{exam_id}') r")
print('START2 (resume):', code, json.dumps(res)[:600])

# cleanup
q(f"delete from online_exams where id = '{exam_id}'")
print('cleaned')
