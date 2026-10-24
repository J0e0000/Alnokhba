#!/usr/bin/env python3
"""Task 44i — deploy edge function via /functions/deploy (JSON body)."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
SLUG = 'send-push-notification'
SRC = open('/home/z/my-project/supabase/functions/send-push-notification/index.ts').read()
assert 'event_id' in SRC

body = {
    'entrypoint_path': 'index.ts',
    'name': SLUG,
    'verify_jwt': False,
    'files': [{'name': 'index.ts', 'content': SRC}],
}
url = f'https://api.supabase.com/v1/projects/{REF}/functions/deploy?slug={SLUG}'
req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={
    'Authorization': f'Bearer {TOK}',
    'Content-Type': 'application/json',
})
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print('deploy status:', r.status, r.read().decode()[:400])
except urllib.error.HTTPError as e:
    print('deploy FAILED:', e.code, e.read().decode(errors='replace')[:500])
    raise SystemExit(1)
print('DEPLOY DONE')
