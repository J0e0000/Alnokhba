#!/usr/bin/env python3
"""Deploy all 4 edge functions (CORS allowlist + rate limiting round). Proven multipart path."""
import json, urllib.request, urllib.error, uuid, sys

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'
CRLF = '\r\n'

EDGES = {
    'admin-account-actions': ['makeJson', 'allowedOrigin', 'renew_team_subscription', 'set_email_config', 'send_test_email'],
    'admin-backup': ['makeJson', 'allowedOrigin', 'consume_rate_limit', 'admin_restore_apply'],
    'ai-parse-homework': ['makeJson', 'allowedOrigin', 'consume_rate_limit', 'rateLimited', 'gemini'],
    'send-push-notification': ['makeJson', 'allowedOrigin', 'browserRateLimited', 'webpush', 'broadcast'],
}

def deploy(slug, markers):
    src = open(f'/home/z/my-project/supabase/functions/{slug}/index.ts', 'rb').read()
    text = src.decode()
    missing = [m for m in markers if m not in text]
    assert not missing, f'{slug}: missing markers {missing}'
    assert '"Access-Control-Allow-Origin": "*"' not in text and "'access-control-allow-origin': '*'" not in text, f'{slug}: still has ACAO wildcard?'
    boundary = '----nokhba' + uuid.uuid4().hex
    def field(name, value):
        return (f'--{boundary}{CRLF}Content-Disposition: form-data; name="{name}"{CRLF}{CRLF}{value}{CRLF}').encode()
    def filefield(name, filename, content):
        head = (f'--{boundary}{CRLF}Content-Disposition: form-data; name="{name}"; filename="{filename}"{CRLF}'
                f'Content-Type: application/x-typescript{CRLF}{CRLF}').encode()
        return head + content + CRLF.encode()
    metadata = {'entrypoint_path': 'index.ts', 'name': slug, 'verify_jwt': slug != 'send-push-notification'}
    body = field('metadata', json.dumps(metadata)) + filefield('file', 'index.ts', src) + f'--{boundary}--{CRLF}'.encode()
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/functions/deploy?slug={slug}',
        data=body, method='POST', headers={'Authorization': f'Bearer {TOK}',
        'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            print(f'{slug}: deploy HTTP {r.status} {r.read().decode()[:120]}')
            return r.status in (200, 201)
    except urllib.error.HTTPError as e:
        print(f'{slug}: deploy FAILED {e.code}: {e.read().decode(errors="replace")[:400]}')
        return False

ok = all([deploy(slug, markers) for slug, markers in EDGES.items()])
sys.exit(0 if ok else 1)
