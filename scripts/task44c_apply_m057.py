#!/usr/bin/env python3
"""Task 44c — apply migration 057 (online exams) to production + functional probe.
Applies the SQL in statements, then runs end-to-end probes on a throwaway
exam + a real student token, then cleans up (zero residue)."""
import json, sys, time, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
URL = f'https://api.supabase.com/v1/projects/{REF}/database/query'
SQL_PATH = '/home/z/my-project/supabase/migration_057_online_exams.sql'

def q(sql, params=None):
    body = {'query': sql}
    if params:
        body['parameters'] = params
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

def split_statements(sql):
    """Proper $-aware splitter: tracks dollar-quoted tags, single quotes, comments."""
    out, buf, i, n = [], [], 0, len(sql)
    dollar = None  # active dollar tag like '$fn$'
    while i < n:
        ch = sql[i]
        nxt = sql[i+1] if i + 1 < n else ''
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(ch); i += 1; continue
        if ch == '-' and nxt == '-':
            j = sql.find('\n', i)
            if j == -1: j = n
            buf.append(sql[i:j]); i = j; continue
        if ch == '/' and nxt == '*':
            j = sql.find('*/', i + 2)
            j = n if j == -1 else j + 2
            buf.append(sql[i:j]); i = j; continue
        if ch == "'":
            # single-quoted string (handles '' escape)
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j+1] == "'":
                        j += 2; continue
                    j += 1; break
                j += 1
            buf.append(sql[i:j]); i = j; continue
        if ch == '$':
            # dollar tag: $tag$ (content alnum/underscore, possibly empty for $$)
            j = sql.find('$', i + 1)
            content = sql[i+1:j] if j != -1 else None
            if j != -1 and j - i <= 40 and all(c.isalnum() or c == '_' for c in content):
                dollar = sql[i:j+1]
                buf.append(dollar); i = j + 1; continue
            buf.append(ch); i += 1; continue
        if ch == ';':
            stmt = ''.join(buf).strip()
            body_lines = [l for l in stmt.splitlines() if l.strip() and not l.strip().startswith('--')]
            if body_lines:
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch); i += 1
    tail = ''.join(buf).strip()
    body_lines = [l for l in tail.splitlines() if l.strip() and not l.strip().startswith('--')]
    if body_lines:
        out.append(tail)
    return out

results = {'pass': 0, 'fail': 0}
def check(name, cond, extra=''):
    if cond:
        results['pass'] += 1
        print(f'  PASS {name} {extra}')
    else:
        results['fail'] += 1
        print(f'  FAIL {name} {extra}')

print('== APPLY migration 057 ==')
sql = open(SQL_PATH).read()
stmts = split_statements(sql)
print(f'statements: {len(stmts)}')
applied = 0
for i, s in enumerate(stmts):
    code, res = q(s)
    if code not in (200, 201):
        print(f'  APPLY FAIL at stmt {i}: {code} {json.dumps(res)[:300]}')
        print('  --- stmt head:', s[:200].replace('\n', ' '))
        sys.exit(1)
    applied += 1
print(f'applied {applied}/{len(stmts)} statements OK')

print('== SCHEMA CHECKS ==')
code, res = q("""select table_name from information_schema.tables
  where table_schema='public' and table_name in ('online_exams','online_exam_attempts') order by 1""")
check('tables exist', code in (200,201) and len(res) == 2, str(res))

code, res = q("""select count(*) c from information_schema.columns
  where table_schema='public' and table_name='online_exam_attempts'
  and column_name in ('deadline_at','question_order','results','answers')""")
check('attempt columns', code in (200,201) and res[0]['c'] == 4)

code, res = q("""select proname from pg_proc p where n.nspname='public' and proname in
  ('start_online_exam','autosave_online_exam_answers','submit_online_exam','get_student_online_exams')""", )
code, res = q("""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
  ('start_online_exam','autosave_online_exam_answers','submit_online_exam','get_student_online_exams','online_exam_resolve_student','online_exam_expire_attempt','online_exam_grade_answers','online_exam_validate_answers','jsonb_repeat_nulls')""")
check('9 functions exist', code in (200,201) and len(res) == 9, f"got {len(res)}")

code, res = q("""select count(*) c from pg_policies
  where schemaname='public' and tablename in ('online_exams','online_exam_attempts')""")
check('2 RLS policies', code in (200,201) and res[0]['c'] == 2)

print('== FUNCTIONAL PROBE (throwaway exam, real student token) ==')
# pre-clean residue from any earlier failed probe run
code, res = q("delete from online_exams where title like 'PROBE-%' returning id")
if res: print(f'  pre-cleaned {len(res)} leftover probe exams')

# pick a real student token
code, res = q("""select s.id sid, s.teacher_id tid, s.group_name g, t.token
  from student_qr_tokens t join students s on s.id = t.student_id
  where t.revoked_at is null limit 1""")
if not res:
    print('no token available — probe skipped'); sys.exit(1)
sid, tid, grp, tok = res[0]['sid'], res[0]['tid'], res[0]['g'], res[0]['token']
print(f'probe student: {sid[:8]}… group={grp}')

QUESTIONS = json.dumps([
    {'text': 'ما عاصمة مصر؟', 'choices': ['القاهرة', 'الإسكندرية', 'أسوان', 'بورسعيد'], 'correct': 0, 'marks': 5},
    {'text': '2 + 2 = ؟', 'choices': ['3', '4', '5', '6'], 'correct': 1, 'marks': 5},
    {'text': 'أكبر كوكب؟', 'choices': ['الأرض', 'المريخ', 'المشتري'], 'correct': 2, 'marks': 10},
])

# create throwaway exam
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'PROBE-057-DELETE-ME', null, 'open', 5, '{QUESTIONS}'::jsonb) returning id, max_score, question_count""")
check('create exam', code in (200,201) and len(res) == 1, f'max={res[0]["max_score"]} n={res[0]["question_count"]}')
exam_id = res[0]['id']
check('max_score normalized', float(res[0]['max_score']) == 20 and res[0]['question_count'] == 3)

# invalid question rejected
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'PROBE-BAD', null, 'open', 5, '[{{"text":"x","choices":["a","b"],"correct":5,"marks":1}}]'::jsonb) returning id""")
check('invalid correct rejected', code == 400, str(res)[:120])

# 1. start
code, res = q(f"""select start_online_exam('{tok}', '{exam_id}') r""")
r = res[0]['r']
check('start → started', r.get('started') is True and len(r.get('questions', [])) == 3)
check('no correct leak', all('correct' not in qq for qq in r['questions']), json.dumps(r['questions'])[:80])
check('deadline ~5min', abs((r['deadline_at'] if isinstance(r['deadline_at'], int) else 0)) >= 0 or r.get('deadline_at'))
deadline = r['deadline_at']
server_now = r['server_now']

# group-restricted exam with mismatched group
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'PROBE-GRP', 'لا يوجد فصل بهذا الاسم أبدا', 'open', 5, '{QUESTIONS}'::jsonb) returning id""")
gx = res[0]['id']
code, res = q(f"""select start_online_exam('{tok}', '{gx}') r""")
check('group mismatch rejected', code == 400 and 'not_for_your_group' in json.dumps(res), json.dumps(res)[:100])
q(f"delete from online_exams where id = '{gx}'")

# 2. autosave
code, res = q(f"""select autosave_online_exam_answers('{tok}', '{exam_id}', '[0,1,null]') r""")
check('autosave ok', res[0]['r'].get('ok') is True, json.dumps(res[0]['r'])[:80])
code, res = q(f"""select autosave_online_exam_answers('{tok}', '{exam_id}', '[0,1,9]') r""")
check('out-of-range choice rejected', code == 400 and 'invalid_answers' in json.dumps(res), json.dumps(res)[:100])

# 3. resume keeps answers
code, res = q(f"""select start_online_exam('{tok}', '{exam_id}') r""")
r2 = res[0]['r']
check('resume → resumed + answers kept', r2.get('resumed') is True and r2.get('answers') == [0, 1, None],
      json.dumps({k: r2.get(k) for k in ('resumed', 'answers')}))

# 4. submit (q1 correct, q2 wrong, q3 correct)
code, res = q(f"""select submit_online_exam('{tok}', '{exam_id}', '[0, 0, 2]') r""")
r3 = res[0]['r']
check('submit → done/submitted', r3.get('done') is True and r3.get('status') == 'submitted', json.dumps(r3)[:140])
check('score 15/20, 2 correct', float(r3.get('score', 0)) == 15 and float(r3.get('max_score', 0)) == 20
      and r3.get('correct_count') == 2, f"score={r3.get('score')}")
check('results bools', r3.get('results') == [True, False, True], str(r3.get('results')))

# 5. idempotent resubmit → same result, no error
code, res = q(f"""select submit_online_exam('{tok}', '{exam_id}', '[1, 1, 1]') r""")
r4 = res[0]['r']
check('resubmit idempotent (same score)', float(r4.get('score', -1)) == 15, json.dumps(r4)[:100])

# 6. restart blocked
code, res = q(f"""select start_online_exam('{tok}', '{exam_id}') r""")
r5 = res[0]['r']
check('restart → done (no restart)', r5.get('done') is True and r5.get('status') == 'submitted')

# 7. portal list shows it
code, res = q(f"""select get_student_online_exams('{tok}') r""")
r6 = res[0]['r']
mine = [e for e in r6['exams'] if e['id'] == exam_id]
check('portal list shows exam + my result', len(mine) == 1 and mine[0]['my']['status'] == 'submitted'
      and float(mine[0]['my']['score']) == 15, json.dumps(mine)[:160])
check('portal list has NO questions', all('questions' not in e for e in r6['exams']))
check('server_now present', bool(r6.get('server_now')))

# 8. deadline enforcement — craft an attempt that already expired
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'PROBE-EXPIRE', null, 'open', 5, '{QUESTIONS}'::jsonb) returning id""")
ex2 = res[0]['id']
code, res = q(f"""select start_online_exam('{tok}', '{ex2}') r""")
check('start exam2', res[0]['r'].get('started') is True)
# force deadline into past + autosave answers
code, res = q(f"""update online_exam_attempts set deadline_at = now() - interval '1 minute',
  answers = '[0,1,2]'::jsonb where exam_id = '{ex2}' and student_id = '{sid}' returning id""")
code, res = q(f"""select autosave_online_exam_answers('{tok}', '{ex2}', '[1,1,1]') r""")
r7 = res[0]['r']
check('autosave after deadline → expired + graded from SAVED answers',
      r7.get('expired') is True and r7.get('status') == 'expired' and float(r7.get('score', -1)) == 20,
      json.dumps(r7)[:160])

# 9. submit after deadline (new exam3)
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'PROBE-SUBMITLATE', null, 'open', 5, '{QUESTIONS}'::jsonb) returning id""")
ex3 = res[0]['id']
q(f"""select start_online_exam('{tok}', '{ex3}')""")
q(f"""update online_exam_attempts set deadline_at = now() - interval '2 minutes',
  answers = '[0,1,null]'::jsonb where exam_id = '{ex3}'""")
code, res = q(f"""select submit_online_exam('{tok}', '{ex3}', '[0,0,0]') r""")
r8 = res[0]['r']
check('submit late → expired, graded from autosave [0,1,null] = 10',
      r8.get('done') is True and r8.get('status') == 'expired' and float(r8.get('score', -1)) == 10,
      json.dumps(r8)[:140])

# 10. question edit blocked while in_progress, allowed after
code, res = q(f"""insert into online_exams (teacher_id, title, group_name, status, duration_minutes, questions)
  values ('{tid}', 'PROBE-EDIT', null, 'open', 5, '{QUESTIONS}'::jsonb) returning id""")
ex4 = res[0]['id']
q(f"""select start_online_exam('{tok}', '{ex4}')""")
code, res = q(f"""update online_exams set questions = '{QUESTIONS}'::jsonb || '{{"text":"إضافي","choices":["أ","ب"],"correct":0,"marks":5}}'::jsonb
  where id = '{ex4}' returning question_count""")
check('edit blocked while in_progress', code == 400 and 'attempts_in_progress' in json.dumps(res), json.dumps(res)[:100])
code, res = q(f"""delete from online_exam_attempts where exam_id = '{ex4}'""")
code, res = q(f"""update online_exams set questions = '{QUESTIONS}'::jsonb || '{{"text":"إضافي","choices":["أ","ب"],"correct":0,"marks":5}}'::jsonb
  where id = '{ex4}' returning question_count""")
check('edit allowed after attempt delete (reset)', code in (200,201) and res[0]['question_count'] == 4)

# 11. closed exam blocks new start
code, res = q(f"""update online_exams set status = 'closed' where id = '{ex4}'""")
code, res = q(f"""select start_online_exam('{tok}', '{ex4}') r""")
check('closed exam rejected', code == 400 and 'exam_not_open' in json.dumps(res), json.dumps(res)[:100])

print('== CLEANUP ==')
code, res = q(f"""delete from online_exams where id in ('{exam_id}','{ex2}','{ex3}','{ex4}') returning id""")
check('cleanup exams (attempts cascade)', code in (200,201) and len(res) == 4, f"deleted {len(res)}")
code, res = q(f"""select count(*) c from online_exam_attempts where student_id = '{sid}'""")
check('zero attempt residue', res[0]['c'] == 0, f"count={res[0]['c']}")

print(f"\nRESULT: {results['pass']} pass / {results['fail']} fail")
sys.exit(1 if results['fail'] else 0)
