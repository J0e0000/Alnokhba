#!/usr/bin/env python3
"""Task 44i — deploy edge function via Management API /functions/deploy (multipart)."""
import json, mimetypes, ssl, urllib.request, uuid

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
SLUG = 'send-push-notification'
SRC = open('/home/z/my-project/supabase/functions/send-push-notification/index.ts', 'rb').read()
assert b'event_id' in SRC

boundary = '----nokhba' + uuid.uuid4().hex
CRLF = '\r\n'

def field(name, value):
    return (f'--{boundary}{CRLF}'
            f'Content-Disposition: form-data; name="{name}"{CRLF}{CRLF}'
            f'{value}{CRLF}').encode()

def filefield(name, filename, content, ctype='application/octet-stream'):
    head = (f'--{boundary}{CRLF}'
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"{CRLF}'
            f'Content-Type: {ctype}{CRLF}{CRLF}').encode()
    return head + content + CRLF.encode()

metadata = {
    'entrypoint_path': 'index.ts',
    'name': SLUG,
    'verify_jwt': False,
}

body = b''
body += field('metadata', json.dumps(metadata))
body += filefield('files', 'index.ts', SRC, 'application/x-typescript')
body += f'--{boundary}--{CRLF}'.encode()

url = f'https://api.supabase.com/v1/projects/{REF}/functions/deploy?slug={SLUG}'
req = urllib.request.Request(url, data=body, method='POST', headers={
    'Authorization': f'Bearer {TOK}',
    'Content-Type': f'multipart/form-data; boundary={boundary}',
})
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print('deploy status:', r.status, r.read().decode()[:400])
except urllib.error.HTTPError as e:
    print('deploy FAILED:', e.code, e.read().decode(errors='replace')[:500])
    raise SystemExit(1)
print('DEPLOY DONE')
