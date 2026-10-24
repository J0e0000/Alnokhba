#!/usr/bin/env python3
"""Task 44i — redeploy the send-push-notification edge function (adds event_id
to the web-push payload so clicking the system notification marks it read)."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

src = open('/home/z/my-project/supabase/functions/send-push-notification/index.ts').read()
assert 'event_id' in src, 'index.ts missing event_id change!'

body = {
    'metadata': {'name': 'send-push-notification', 'verify_jwt': False},
    'files': [{'name': 'index.ts', 'content': src}],
}

req = urllib.request.Request(
    f'https://api.supabase.com/v1/projects/{REF}/functions?slug=send-push-notification',
    data=json.dumps(body).encode(),
    headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        print('deploy status:', r.status, r.read().decode()[:300])
except urllib.error.HTTPError as e:
    print('deploy FAILED:', e.code, e.read().decode(errors='replace')[:500])
    raise SystemExit(1)

# verify: ping the function
import time
time.sleep(3)
fn_url = f'https://{REF}.supabase.co/functions/v1/send-push-notification'
preq = urllib.request.Request(fn_url, data=json.dumps({'action': 'ping'}).encode(),
                              headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(preq, timeout=30) as r:
        print('ping:', r.status, r.read().decode()[:200])
except urllib.error.HTTPError as e:
    print('ping note:', e.code, e.read().decode(errors='replace')[:200])
print('EDGE FUNCTION DEPLOY DONE')
