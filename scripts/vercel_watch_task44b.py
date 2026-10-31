#!/usr/bin/env python3
"""Watch Vercel deployment for Task 44b (commit c1a31c20)."""
import json, time, urllib.request

TOK = open('/home/z/my-project/.secrets/vercel-token').read().strip()
PROJECT = 'frontend-alfares'
COMMIT = 'c1a31c20'

def api(path):
    req = urllib.request.Request(f'https://api.vercel.com{path}',
        headers={'Authorization': f'Bearer {TOK}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

for attempt in range(60):
    try:
        deps = api(f'/v6/deployments?projectId=prj_SvwV7aY058uXJhzplxe8lDe4nKta&limit=3&target=production')
        for d in deps.get('deployments', []):
            sha = (d.get('meta') or {}).get('githubCommitSha', '')[:8]
            state = d.get('readyState')
            print(f"{d.get('uid')} {state} @{sha} ({d.get('createdAt')})")
            if sha == COMMIT:
                if state == 'READY':
                    print(f'DEPLOY READY: https://{d.get("url")}')
                    raise SystemExit(0)
                if state in ('ERROR', 'CANCELED'):
                    print('DEPLOY FAILED'); raise SystemExit(1)
    except SystemExit:
        raise
    except Exception as e:
        print('api err:', e)
    time.sleep(20)
print('TIMEOUT')
