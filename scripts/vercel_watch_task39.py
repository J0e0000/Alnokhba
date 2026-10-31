#!/usr/bin/env python3
"""Task 39 — watch Vercel deployments for the landing redesign commit (c0aab894).
Team-scan mode (scoped token + projectId filter returns 404). READY/ERROR ends."""
import json, os, time, urllib.request

TARGET = 'c0aab894'
TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()


def get(url):
    req = urllib.request.Request(url, headers={'authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


for attempt in range(40):
    try:
        deps = get('https://api.vercel.com/v6/deployments?limit=10')
        for d in deps.get('deployments', []):
            sha = d.get('meta', {}).get('githubCommitSha', '')[:8]
            if sha == TARGET:
                state = d.get('readyState', d.get('state'))
                print(f"[{attempt}] {d.get('uid')} {state} ({d.get('url')})")
                if state in ('READY', 'ERROR', 'CANCELED'):
                    print('FINAL:', state)
                    raise SystemExit(0 if state == 'READY' else 1)
                break
        else:
            print(f"[{attempt}] commit {TARGET} not in last 10 deployments yet")
    except SystemExit:
        raise
    except Exception as e:
        print(f"[{attempt}] err: {e}")
    time.sleep(15)
print('TIMEOUT')
raise SystemExit(2)
