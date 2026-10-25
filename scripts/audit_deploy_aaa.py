#!/usr/bin/env python3
"""Security audit — redeploy admin-account-actions (password min 10) via the CLI-style multipart endpoint
(POST /functions/deploy?slug=) which runs a proper esbuild → boot-safe deploy.
Falls back to reporting the server's build error verbatim."""
import json, mimetypes, urllib.request, uuid

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
SLUG = 'admin-account-actions'
SRC = open('/home/z/my-project/supabase/functions/admin-account-actions/index.ts', 'rb').read()
SRC_TEXT = SRC.decode()
for marker in ('renew_team_subscription', 'set_email_config', 'send_test_email', 'get_email_config'):
    assert marker in SRC_TEXT, f'missing marker {marker}'

boundary = '----nokhba' + uuid.uuid4().hex
CRLF = '\r\n'

def field(name, value):
    return (f'--{boundary}{CRLF}'
            f'Content-Disposition: form-data; name="{name}"{CRLF}{CRLF}'
            f'{value}{CRLF}').encode()

def filefield(name, filename, content, ctype='application/x-typescript'):
    head = (f'--{boundary}{CRLF}'
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"{CRLF}'
            f'Content-Type: {ctype}{CRLF}{CRLF}').encode()
    return head + content + CRLF.encode()

metadata = {'entrypoint_path': 'index.ts', 'name': SLUG, 'verify_jwt': True}
body = (field('metadata', json.dumps(metadata))
        + filefield('file', 'index.ts', SRC)
        + f'--{boundary}--{CRLF}'.encode())

url = f'https://api.supabase.com/v1/projects/{REF}/functions/deploy?slug={SLUG}'
req = urllib.request.Request(url, data=body, method='POST', headers={
    'Authorization': f'Bearer {TOK}',
    'Content-Type': f'multipart/form-data; boundary={boundary}',
})
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        print('deploy status:', r.status, r.read().decode()[:500])
except urllib.error.HTTPError as e:
    print('deploy FAILED:', e.code, e.read().decode(errors='replace')[:800])
    raise SystemExit(1)
print('DEPLOY DONE')
