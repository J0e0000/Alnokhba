#!/usr/bin/env python3
"""Watch Vercel deployments until the one for commit 1b56834e is READY."""
import json, time, urllib.request, urllib.error

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()
PROJECT = 'frontend-alfares'
TEAM = ''
SHA = '1b56834e'
BASE = 'https://api.vercel.com'


def get(path):
    req = urllib.request.Request(f'{BASE}{path}?limit=10{"&projectId=" + PROJECT if "deployments" in path else ""}',
                                 headers={'authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    deadline = time.time() + 900
    seen = set()
    while time.time() < deadline:
        try:
            data = get('/v6/deployments')
            for d in data.get('deployments', []):
                meta = d.get('meta', {}) or {}
                sha = (meta.get('githubCommitSha') or '')[:8]
                if SHA not in (sha, d.get('meta', {}).get('githubCommitRef', '')):
                    continue
                uid = d['uid']
                state = d.get('state') or d.get('readyState')
                if uid not in seen:
                    seen.add(uid)
                    print(f'{d.get("created_at")} {state} {d.get("url")} sha={sha or "?"}')
                if state in ('READY', 'ERROR', 'CANCELED'):
                    print('FINAL:', state)
                    return 0 if state == 'READY' else 1
        except urllib.error.HTTPError as e:
            print('API ERR', e.code, e.read()[:200])
        time.sleep(20)
    print('TIMEOUT waiting for deploy')
    return 1


if __name__ == '__main__':
    sys_exit = main()
    raise SystemExit(sys_exit)
