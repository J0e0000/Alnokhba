#!/usr/bin/env python3
"""Task 33 — watch Vercel deployment until READY (or ERROR)."""
import json, time, urllib.request, sys

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip().replace('\n', '')
BASE = 'https://api.vercel.com'
TARGET_COMMIT = '0c263a85'

def api(path):
    req = urllib.request.Request(BASE + path, headers={'Authorization': 'Bearer ' + TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

# team-scan mode (scoped token returned 404 on projectId filter in task 32)
deadline = time.time() + 600
seen = {}
while time.time() < deadline:
    try:
        data = api('/v6/deployments?limit=8')
        deps = data.get('deployments', [])
    except Exception as e:
        print('api err:', e); time.sleep(15); continue
    for d in deps:
        sha = (d.get('meta') or {}).get('githubCommitSha', '')[:8]
        did = d.get('uid')
        if TARGET_COMMIT and sha and TARGET_COMMIT not in sha and did not in seen:
            continue
        if did not in seen or seen[did] != d.get('readyState'):
            seen[did] = d.get('readyState')
            print(f"{did} {d.get('readyState'):8} commit={sha} created={d.get('created')} url={d.get('url')}")
            if d.get('readyState') == 'READY':
                print('DEPLOY_READY', d.get('url'))
                sys.exit(0)
            if d.get('readyState') == 'ERROR':
                print('DEPLOY_ERROR')
                sys.exit(1)
    time.sleep(12)
print('TIMEOUT')
sys.exit(2)
