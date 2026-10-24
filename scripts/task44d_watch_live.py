#!/usr/bin/env python3
"""Watch al-nokhbba.vercel.app until the Task 44d build propagates, then verify."""
import re, sys, time, urllib.request

def get(url):
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf8', 'ignore')

def entry(html):
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
    return m.group(1) if m else None

expected_strings_entry = ['PublicHomeworkPage']  # lazy import ref in App chunk
expected_strings_hw = ['صفحة الواجبات', 'تسليم الواجب', 'ما جبتش عليها', '/hw/']
expected_strings_pqr = ['تسليم الواجب', 'فعّل الإشعارات']

deadline = time.time() + 900
print('watching for new deployment (entry hash != index-CYaqYqQI.js)...')
new_entry = None
while time.time() < deadline:
    try:
        html = get('https://al-nokhbba.vercel.app/')
        e = entry(html)
        if e and e != '/assets/index-CYaqYqQI.js':
            new_entry = e
            print('NEW ENTRY:', e)
            break
        print(f'  {time.strftime("%H:%M:%S")} still {e}')
    except Exception as ex:
        print('  err', ex)
    time.sleep(25)

if not new_entry:
    print('TIMEOUT — deployment not visible in 15 min')
    sys.exit(1)

# fetch entry chunk → find PublicHomeworkPage chunk name via dynamic import map
entry_js = get('https://al-nokhbba.vercel.app' + new_entry)
m = re.findall(r'assets/(?:PublicHomeworkPage|PublicQRPage)-[A-Za-z0-9_-]+\.js', entry_js)
print('page chunks referenced:', sorted(set(m)))

def chunk_urls():
    # scan ALL chunks listed in entry for the two page chunks
    names = sorted(set(re.findall(r'assets/[A-Za-z0-9_-]+\.js', entry_js)))
    # also try predictable names from the reference above
    names += sorted(set(m))
    return sorted(set(names))

hw_ok = pqr_ok = False
for name in chunk_urls():
    try:
        js = get('https://al-nokhbba.vercel.app/' + name)
    except Exception:
        continue
    if 'PublicHomeworkPage' in name or 'صفحة الواجبات' in js:
        if all(s in js for s in ['صفحة الواجبات', 'تسليم الواجب']):
            hw_ok = True
            print('HW PAGE OK:', name)
    if 'PublicQRPage' in name:
        has = [s for s in ['فعّل الإشعارات', 'تسليم الواجب'] if s in js]
        if has:
            pqr_ok = True
            print('PORTAL OK:', name, has)

# /hw/ SPA route serves index.html
try:
    hw_html = get('https://al-nokhbba.vercel.app/hw/probe-token-123')
    route_ok = '<div id="root">' in hw_html and entry(hw_html) is not None
    print('HW ROUTE OK' if route_ok else 'HW ROUTE FAIL')
except Exception as ex:
    print('HW ROUTE err', ex)
    route_ok = False

print('RESULT:', 'ALL GREEN' if (hw_ok and pqr_ok and route_ok) else f'hw={hw_ok} pqr={pqr_ok} route={route_ok}')
sys.exit(0 if (hw_ok and pqr_ok and route_ok) else 1)
