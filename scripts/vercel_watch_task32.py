#!/usr/bin/env python3
"""Watch Vercel deployment for Task 32 commit e1f08923 until READY/ERROR."""
import json, time, urllib.request, sys

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()
TEAM = 'team_o8Qpk9vlO97eXE6d9mQQVAlK'
TARGET = 'e1f08923'

def api(url):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

target = TARGET
deadline = time.time() + 420
seen = None
while time.time() < deadline:
    try:
        data = api(f'https://api.vercel.com/v6/deployments?limit=15&teamId={TEAM}')
        for d in data.get('deployments', []):
            meta = d.get('meta', {}) or {}
            sha = (meta.get('githubCommitSha') or '')[:8]
            if target and sha != target:
                continue
            state = d.get('readyState')
            uid = d.get('uid')
            if (uid, state) != seen:
                print(f"[{time.strftime('%H:%M:%S')}] {uid} sha={sha} state={state} url={d.get('url')}")
                seen = (uid, state)
            if state in ('READY', 'ERROR', 'CANCELED'):
                print('FINAL:', state, '->', f"https://{d.get('url')}" if d.get('url') else '')
                sys.exit(0 if state == 'READY' else 1)
    except Exception as e:
        print('poll error:', e)
    time.sleep(15)
print('TIMEOUT')
sys.exit(2)
