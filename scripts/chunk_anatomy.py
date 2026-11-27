#!/usr/bin/env python3
"""Attribute main-bundle bytes to source modules via the sourcemap."""
import json, os, sys
from collections import defaultdict

chunk = sys.argv[1] if len(sys.argv) > 1 else 'dist/app-v2/index-Bj8zpunp.js'
mp = chunk + '.map'
data = json.load(open(mp))
srcs = data['sources']

# VLQ decode of mappings: sum per source line count of generated columns span
B64 = {}
A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for i, c in enumerate(A):
    B64[c] = i

def spans_per_source(mapping_str):
    counts = defaultdict(int)
    gen_col = 0; src_idx = 0; src_line = 0; src_col = 0
    for line in mapping_str.split(';'):
        gen_col = 0
        for seg in line.split(','):
            if not seg:
                continue
            vals = []
            shift = 0; value = 0
            for ch in seg:
                d = B64[ch]
                value += (d & 31) << shift
                if d & 32:
                    shift += 5
                else:
                    v = value >> 1
                    vals.append(-v if value & 1 else v)
                    value = 0; shift = 0
            gen_col += vals[0]
            if len(vals) >= 4:
                src_idx += vals[1]; src_line += vals[2]; src_col += vals[3]
                counts[src_idx] += 1
    return counts

counts = spans_per_source(data['mappings'])
total = sum(counts.values())
agg = defaultdict(int)
for idx, c in counts.items():
    s = srcs[idx].replace('\\\\', '/')
    if 'node_modules' in s:
        pkg = s.split('node_modules/')[-1]
        pkg = pkg.split('/')[0] if not pkg.startswith('@') else '/'.join(pkg.split('/')[:2])
        key = f'npm:{pkg}'
    else:
        parts = s.split('src/')[-1].split('/')
        key = 'src:' + (parts[0] if len(parts) > 1 else parts[-1])
    agg[key] += c

print(f'chunk: {chunk}  file size: {os.path.getsize(chunk)/1024:.0f} KB  (spans are proportional share, not bytes)')
for k, v in sorted(agg.items(), key=lambda x: -x[1])[:30]:
    print(f'{v*100/total:6.2f}%  {k}')
