#!/usr/bin/env python3
"""Task 31 deploy watcher: team-scan for the Alnokhba deployment of commit 38e68dcf."""
import json, os, time, urllib.request

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()
TEAM = 'team_o8Qpk9vlO97eXE6d9mQQVAlK'
SHA = '38e68dcf2ebe'

def api(url):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

for attempt in range(40):
    try:
        data = api(f'https://api.vercel.com/v6/deployments?limit=10&teamId={TEAM}&project=frontend-alfares')
        deps = data.get('deployments', [])
        match = [d for d in deps if (d.get('meta') or {}).get('githubCommitSha', '').startswith(SHA)]
        if not match:
            print(f'[{attempt}] no deployment for {SHA[:8]} yet; latest:', [(d.get("uid"), (d.get("meta") or {}).get("githubCommitSha", "")[:8], d.get("readyState")) for d in deps[:3]])
        else:
            d = match[0]
            state = d.get('readyState')
            print(f'[{attempt}] {d["uid"]} state={state}')
            if state == 'READY':
                print('READY:', d.get('url'))
                break
            if state in ('ERROR', 'CANCELED'):
                print('FAILED:', d.get('uid')); break
    except Exception as e:
        print(f'[{attempt}] api error: {e}')
    time.sleep(15)
