#!/usr/bin/env python3
"""Watch Vercel deploy status for commit c632f292 via GitHub commit-status API."""
import json, ssl, time, subprocess, sys

SHA = 'c632f292'
ctx = ssl.create_default_context()
# token lives in the git remote URL (oauth2:...); never printed
REMOTE = subprocess.run(['git', '-C', '/home/z/my-project', 'remote', 'get-url', 'origin'],
                        capture_output=True, text=True).stdout.strip()
import re
m = re.match(r'https://oauth2:([^@]+)@github\.com', REMOTE)
if not m:
    sys.exit('no token found in remote URL')
TOK = m.group(1)
URL = f'https://api.github.com/repos/J0e0000/Alnokhba/commits/{SHA}/status'

deadline = time.time() + 900
seen = set()
while time.time() < deadline:
    req = urllib_request = None
    import urllib.request
    r = urllib.request.Request(URL, headers={'Authorization': f'Bearer {TOK}', 'User-Agent': 'nokhba-ops'})
    with urllib.request.urlopen(r, timeout=30, context=ctx) as resp:
        data = json.loads(resp.read().decode())
    state = data.get('state')
    for s in data.get('statuses', []):
        key = (s.get('context'), s.get('state'))
        if key not in seen:
            seen.add(key)
            print(f"  {s.get('context')}: {s.get('state')} ({s.get('target_url') or ''})"[:160], flush=True)
    print(f"t+{int(900-(deadline-time.time()))}s state={state}", flush=True)
    if state in ('success', 'failure', 'error'):
        sys.exit(0 if state == 'success' else 2)
    time.sleep(25)
print('TIMEOUT waiting for deploy')
sys.exit(3)
