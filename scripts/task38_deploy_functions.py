#!/usr/bin/env python3
"""Task 38 — redeploy admin-account-actions + admin-backup edge functions to
PRODUCTION via the Supabase Management API (bundled multipart deploy endpoint).
Preserves each function's current verify_jwt setting. Never prints the token."""
import json, sys, urllib.request, uuid

BASE = 'https://api.supabase.com/v1'
REF = 'pbsythpzncjoafpmijyd'
FUNCS = '/home/z/my-project/supabase/functions'
# current config measured via GET /functions (Task 38 apply script output)
TARGETS = {
    'admin-account-actions': {'verify_jwt': True},
    'admin-backup': {'verify_jwt': False},
}


def tok():
    return open('/home/z/my-project/.secrets/supabase-access-token').read().strip()


def deploy(slug, verify_jwt):
    src = open(f'{FUNCS}/{slug}/index.ts', encoding='utf-8').read()
    boundary = '----task38-' + uuid.uuid4().hex
    meta = json.dumps({'entrypoint_path': 'index.ts', 'name': slug, 'verify_jwt': verify_jwt})

    parts = []
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n'
        f'Content-Type: application/json\r\n\r\n{meta}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.ts"\r\n'
        f'Content-Type: application/typescript\r\n\r\n'.encode() + src.encode() + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    body = b''.join(parts)

    req = urllib.request.Request(
        f'{BASE}/projects/{REF}/functions/deploy', data=body, method='POST',
        headers={'authorization': f'Bearer {tok()}',
                 'content-type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:600]


def gateway_probe(slug, verify_jwt):
    url = f'https://{REF}.supabase.co/functions/v1/{slug}'
    req = urllib.request.Request(url, data=b'{}', method='POST',
                                 headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


VERIFY_SLUGS = {
    'admin-account-actions': {'verify_jwt': True},
    'admin-backup': {'verify_jwt': False},
}


def main():
    do_deploy = not (len(sys.argv) > 1 and sys.argv[1] == 'verify')
    for slug, cfg in (TARGETS.items() if do_deploy else []):
        st, res = deploy(slug, cfg['verify_jwt'])
        ok = st in (200, 201)
        print(f"deploy {slug}: HTTP {st} {'OK' if ok else 'FAILED'}")
        print('  ', json.dumps(res, ensure_ascii=False)[:300])
        if not ok:
            sys.exit(2)

    # verify: updated_at must be fresh; then hit the gateway with no auth
    req = urllib.request.Request(f'{BASE}/projects/{REF}/functions',
                                 headers={'authorization': f'Bearer {tok()}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        fns = json.loads(r.read().decode())
    import time
    now_ms = time.time() * 1000
    for f in fns:
        if f['slug'] in VERIFY_SLUGS:
            age_s = (now_ms - f['updated_at']) / 1000
            print(f"{f['slug']}: status={f.get('status')} verify_jwt={f.get('verify_jwt')} updated {age_s:.0f}s ago")
            st, body = gateway_probe(f['slug'], f.get('verify_jwt'))
            print(f"  gateway probe (no auth): HTTP {st} -> {body[:140]}")


if __name__ == '__main__':
    main()
