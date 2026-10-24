#!/usr/bin/env python3
"""Task 44j — end-to-end test of the new admin-account-actions actions.
Admin JWT = real signup session of a throwaway user elevated to is_admin via
Management SQL (is_admin_user() reads profiles.is_admin by auth.uid()). A
second throwaway user is the renewal target. Everything is cleaned up at the
end (incl. the fake Resend key written during the test)."""
import json, time, urllib.request, urllib.error, datetime

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
BASE = f'https://api.supabase.com/v1/projects/{REF}'
URL = f'https://{REF}.supabase.co'

def mgmt(method, path, payload=None, timeout=90):
    req = urllib.request.Request(f'{BASE}/{path}', method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:400]}') from e

def q(sql):
    return mgmt('POST', 'database/query', {'query': sql})

ANON = [k for k in mgmt('GET', 'api-keys') if k['id'] == 'anon'][0]['api_key']
print('anon key ok:', ANON[:24], '…', flush=True)

# pre-clean leftovers from any crashed earlier run
q("delete from admin_teams where name like '%44ج%'")
q("delete from admin_email_config where value like 're_test_%'")
leftover = q("select string_agg(format('%L', id), ',') ids from profiles where email like '44j-%'")
ids = (leftover[0].get('ids') if leftover else None)
if ids:
    q(f"delete from auth.users where id in ({ids})")
time.sleep(1)
print('pre-clean done:', q("select count(*) n from profiles where email like '44j-%'"), flush=True)

results = []
def check(name, ok, extra=''):
    results.append((name, ok))
    print(('PASS  ' if ok else 'FAIL  ') + name, extra, flush=True)

def signup(email, name):
    req = urllib.request.Request(f'{URL}/auth/v1/signup', method='POST',
        data=json.dumps({'email': email, 'password': 'xK9#vQ2m' + str(int(time.time())), 'data': {'full_name': name}}).encode(),
        headers={'apikey': ANON, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError('signup failed: ' + e.read().decode(errors='replace')[:300])
    uid = d.get('user', {}).get('id')
    jwt = d.get('access_token')
    if not jwt and d.get('session'):
        jwt = d['session'].get('access_token')
    return uid, jwt

ts = int(time.time())
target_uid, _ = signup(f'44j-target-{ts}@example.com', 'هدف اختبار 44ج')
admin_uid, admin_jwt = signup(f'44j-admin-{ts}@example.com', 'أدمن اختبار 44ج')
q(f"update profiles set is_admin = true, is_verified = true, subscription_status = 'active' where id = '{admin_uid}'")
time.sleep(1)
prow = q(f"select is_admin, email from profiles where id='{admin_uid}'")[0]
check('throwaway admin ready', prow['is_admin'] is True, f"{admin_uid[:8]} {prow['email']}")
tgt = q(f"select id, email from profiles where id='{target_uid}'")
check('throwaway target profile (trigger)', len(tgt) == 1, str(tgt[:1]))

def fn_call(body):
    req = urllib.request.Request(f'{URL}/functions/v1/admin-account-actions', method='POST',
        data=json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {admin_jwt}', 'apikey': ANON, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {'__http__': e.code, '__body__': e.read().decode(errors='replace')[:300]}

r = fn_call({'action': 'get_email_config'})
check('get_email_config before', r.get('configured') is False and r.get('source') == 'none', str(r)[:140])

r = fn_call({'action': 'set_email_config', 'resendApiKey': 're_test_44jkey1234567890', 'from': 'Alnokhba <noreply@example.com>'})
check('set_email_config', r.get('ok') and r.get('configured') and (r.get('masked_key') or '').startswith('re_tes'), str(r)[:180])

r = fn_call({'action': 'get_email_config'})
check('get_email_config after (db source)', r.get('configured') and r.get('source') == 'db', str(r)[:180])

r = fn_call({'action': 'send_test_email', 'to': '44j-test@example.com'})
ok = r.get('ok') and r.get('email', {}).get('sent') is False and 'Resend' in str(r.get('email', {}).get('error', ''))
check('send_test_email (resend reachable, key rejected)', ok, str(r)[:220])

def rpc(name, args):
    req = urllib.request.Request(f'{URL}/rest/v1/rpc/{name}', method='POST',
        data=json.dumps(args).encode(),
        headers={'Authorization': f'Bearer {admin_jwt}', 'apikey': ANON, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{name}: HTTP {e.code}: ' + e.read().decode(errors='replace')[:250])

team_id = rpc('admin_upsert_team', {'p_id': None, 'p_name': 'فريق اختبار 44ج (يُحذف)', 'p_description': None, 'p_color': '#D4AF37', 'p_logo_url': None, 'p_status': 'active'})
rpc('admin_team_add_members', {'p_team_id': team_id, 'p_profile_ids': [target_uid]})
check('temp team + member', bool(team_id), str(team_id)[:8])

future = (datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=7)).replace(hour=23, minute=59).strftime('%Y-%m-%dT%H:%M:%SZ')
r = fn_call({'action': 'renew_team_subscription', 'teamId': team_id, 'newExpiresAt': future, 'planName': 'اختبار 44ج', 'sendEmail': True})
first_fail = (r.get('email', {}).get('failed') or [{}])[0].get('error', '')
ok = (r.get('ok') and r.get('total') == 1 and len(r.get('renewed', [])) == 1
      and r.get('email', {}).get('attempted') == 1 and r.get('email', {}).get('sent') == 0
      and 'Resend' in str(first_fail))
check('renew_team date-mode (renewal saved, email failure recorded)', ok, str(r)[:300])

row = q(f"select subscription_status, subscription_expires_at::date d from profiles where id='{target_uid}'")[0]
check('target profile expiry updated', row['subscription_status'] == 'active', str(row))
ren = q(f"select email_status, plan_name from subscription_renewals where teacher_id='{target_uid}' order by created_at desc limit 1")[0]
check('renewal row written (email failed recorded)', ren['email_status'] == 'failed' and ren['plan_name'] == 'اختبار 44ج', str(ren))

r = fn_call({'action': 'renew_team_subscription', 'teamId': team_id, 'days': 30, 'sendEmail': False})
row2 = q(f"select subscription_expires_at::date d from profiles where id='{target_uid}'")[0]
delta = (datetime.date.fromisoformat(row2['d']) - datetime.date.fromisoformat(row['d'])).days
check('renew_team days-mode (+30 from current expiry)', r.get('ok') and len(r.get('renewed', [])) == 1 and r.get('email', {}).get('attempted') == 0 and delta == 30, f'delta={delta}')

audit = q("select count(*) n from admin_audit_logs where action='renew_team_subscription'")[0]['n']
check('audit row for team renewal', audit >= 1, f'n={audit}')

# CLEANUP — remove everything the test created (fake key must NOT survive)
q(f"delete from subscription_renewals where teacher_id='{target_uid}'")
q(f"delete from admin_activity_log where target_teacher_id='{target_uid}'")
q("delete from admin_email_config")
rpc('admin_delete_team_v2', {'p_team_id': team_id})
q(f"delete from auth.users where id in ('{target_uid}','{admin_uid}')")
time.sleep(1)
left = q(f"select (select count(*) from admin_team_members m join admin_teams t on t.id=m.team_id where t.name like '%44ج%') mem, (select count(*) from admin_email_config) cfg, (select count(*) from profiles where id in ('{target_uid}','{admin_uid}')) prof")[0]
check('cleanup complete (incl. fake key removed)', left['mem'] == 0 and left['cfg'] == 0 and left['prof'] == 0, str(left))

fails = [n for n, ok in results if not ok]
print(f"\nRESULT: {'ALL GREEN' if not fails else str(len(fails)) + ' FAILURES: ' + ', '.join(fails)}", flush=True)
