#!/usr/bin/env python3
"""Task 35 Vercel deployment watcher — team-scan mode (scoped token can't filter by projectId)."""
import os, time, json, urllib.request

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()
TARGET = 'd6ab2cf9'
API = 'https://api.vercel.com/v6/deployments?limit=10&teamId='

def get(url):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

for i in range(60):
    try:
        data = get(API + os.environ.get('VERCEL_TEAM_ID', ''))
        deps = data.get('deployments', [])
        match = [d for d in deps if TARGET in json.dumps(d.get('meta', {}))]
        if match:
            d = match[0]
            state, uid, url = d.get('readyState'), d.get('uid'), d.get('url')
            print(f"[{i}] {TARGET}: {state} | {uid} | {url}", flush=True)
            if state == 'READY':
                print("DEPLOYMENT READY:", f"https://{url}", flush=True)
                break
            if state in ('ERROR', 'CANCELED'):
                print("DEPLOYMENT FAILED:", state, flush=True)
                raise SystemExit(1)
        else:
            print(f"[{i}] no deployment for {TARGET} yet ({len(deps)} scanned)", flush=True)
    except SystemExit:
        raise
    except Exception as e:
        print(f"[{i}] scan error: {e}", flush=True)
    time.sleep(15)
else:
    raise SystemExit("TIMEOUT waiting for deployment")
