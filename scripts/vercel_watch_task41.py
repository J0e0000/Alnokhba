"""Task 41 — watch Vercel deployment for commit d7a7d39e until READY/ERROR."""
import json, time, urllib.request

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()
SHA = 'd7a7d39e'
URL = 'https://api.vercel.com/v6/deployments?limit=10&project=frontend-alfares'

def req():
    r = urllib.request.Request(URL, headers={'Authorization': f'Bearer {TOKEN}'})
    with urllib.request.urlopen(r, timeout=30) as res:
        return json.load(res)

for i in range(40):
    try:
        data = req()
        for d in data.get('deployments', []):
            meta = (d.get('meta') or {})
            sha = (meta.get('githubCommitSha') or meta.get('githubCommitRef') or '')[:8]
            if sha == SHA:
                print(f"found: {d['uid']} state={d.get('state')} ready={d.get('readyState')} url={d.get('url')}")
                if d.get('readyState') in ('READY', 'ERROR', 'CANCELED'):
                    print('DONE', d.get('readyState'))
                    raise SystemExit(0 if d.get('readyState') == 'READY' else 1)
    except SystemExit:
        raise
    except Exception as e:
        print('poll err:', e)
    time.sleep(15)
print('TIMEOUT')
raise SystemExit(2)
