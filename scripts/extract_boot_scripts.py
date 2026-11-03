#!/usr/bin/env python3
"""Extract the 4 classic inline boot scripts from index.html into public/boot/*.js
and replace each with <script src="/boot/*.js"> — enables dropping 'unsafe-inline'
from script-src. Byte-exact JS content preserved (semantics identical: classic
scripts with src still execute synchronously in document order)."""
import re, os

P = '/home/z/my-project/frontend/index.html'
html = open(P, encoding='utf-8').read()

# classic inline scripts: <script> ... </script> (no attrs, no type=module/src)
pat = re.compile(r'<script>\n(.*?)\n\s*</script>', re.DOTALL)
matches = list(pat.finditer(html))
print(f"classic inline scripts found: {len(matches)}")
assert len(matches) == 4, f"expected 4 inline scripts, found {len(matches)}"

names = ['storage-gen', 'diag-engine', 'ios-shims', 'prerender-fastpath']
os.makedirs('/home/z/my-project/frontend/public/boot', exist_ok=True)

out, last, order = [], 0, []
for m, name in zip(matches, names):
    body = m.group(1)
    # sanity markers per script (order in document)
    out.append(html[last:m.start()])
    out.append(f'<script src="/boot/{name}.js"></script>')
    last = m.end()
    order.append((name, len(body)))
    with open(f'/home/z/my-project/frontend/public/boot/{name}.js', 'w', encoding='utf-8') as f:
        f.write(body + '\n')
out.append(html[last:])
open(P, 'w', encoding='utf-8').write(''.join(out))
print("extracted:", order)
print("index.html now has inline scripts:", re.findall(r'<script(?![^>]*src)[^>]*>', ''.join(out)))
