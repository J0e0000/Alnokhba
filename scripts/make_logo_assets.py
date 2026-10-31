#!/usr/bin/env python3
"""
make_logo_assets.py — Generate all web logo assets for Alnokhba from the
user-approved master artwork (upload/1x1 Redesigned Alnokhba Logo.png).

Outputs (overwrites) into public/:
  nokhba-mark.svg      — square mark (A icon) on white tile, embedded PNG (app-wide <img> mark)
  favicon.svg          — transparent mark, embedded 64px PNG
  favicon-64.png       — transparent mark 64
  favicon.png          — transparent mark 32 (legacy name)
  logo-192.png         — full lockup on white (apple-touch + manifest any)
  logo-512.png         — full lockup on white (og:image / JSON-LD / manifest any)
  logo-maskable-512.png— mark centered inside PWA safe zone, white bg (manifest maskable)
  logo.png             — lockup white 512 (legacy name)
  logo-icon.png        — transparent mark 512 (legacy name)
  nokhba-logo.png      — lockup white 512 (legacy name)
  nokhba-logo-restored.png      — lockup transparent 512 (legacy name)
  nokhba-official-transparent.png— lockup transparent 512 (legacy name)
  nokhba-logo.svg / nokhba-official.svg / logo.svg — lockup on white, embedded PNG
"""
import base64
import io
from PIL import Image
import numpy as np

SRC = '/home/z/my-project/upload/1x1 Redesigned Alnokhba Logo.png'
PUB = '/home/z/my-project/public'

img = Image.open(SRC).convert('RGB')
W, H = img.size
arr = np.asarray(img).astype(np.int16)

# ── content bbox (non-white) ────────────────────────────────────────────────
dist = 255 - arr.min(axis=2)               # 0 = pure white
mask = dist > 12
rows = np.where(mask.any(axis=1))[0]
cols = np.where(mask.any(axis=0))[0]
top, bottom, left, right = rows[0], rows[-1], cols[0], cols[-1]
print(f'canvas {W}x{H}  content bbox x[{left},{right}] y[{top},{bottom}]')

# ── find the full-width white separator band between mark and wordmark ─────
sub = dist[top:bottom + 1, left:right + 1]
white_row = (sub > 6).sum(axis=1) == 0     # row entirely ~white
bands = []
start = None
for i, w in enumerate(white_row):
    if w and start is None:
        start = i
    elif not w and start is not None:
        bands.append((start, i - 1))
        start = None
if start is not None:
    bands.append((start, len(white_row) - 1))
# widest interior band = separator
bands.sort(key=lambda b: b[1] - b[0], reverse=True)
if not bands:
    raise SystemExit('no separator band found — single-block artwork?')
sep_start, sep_end = bands[0]
mark_bottom = top + sep_start - 1
print(f'separator band rows {sep_start}..{sep_end} (h={sep_end-sep_start+1}) → mark ends at y={mark_bottom}')

mark_bbox = (left, top, right + 1, mark_bottom + 1)
word_top = top + sep_end + 1
lockup_bbox = (left, top, right + 1, bottom + 1)
# The wordmark is WIDER than the A-mark → compute the mark's own x-range so
# the mark tile doesn't inherit the wordmark's side margins.
mark_mask_rows = mask[top:mark_bottom + 1]
mcols = np.where(mark_mask_rows.any(axis=0))[0]
mark_slice = mask[top:mark_bottom + 1, mcols[0]:mcols[-1] + 1]
mr = np.where(mark_slice.any(axis=1))[0]
mark_bbox = (int(mcols[0]), int(top + mr[0]), int(mcols[-1]) + 1, int(top + mr[-1]) + 1)
print(f'mark bbox {mark_bbox}  wordmark starts y={word_top}')

# ── white → alpha (transparent variants) ───────────────────────────────────
def to_rgba(im):
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    d = 255 - a.min(axis=2)
    alpha = np.clip((d - 10) * (255.0 / (45 - 10)), 0, 255).astype(np.uint8)
    rgba = np.dstack([a.astype(np.uint8), alpha])
    return Image.fromarray(rgba)

# ── square-pad helper ───────────────────────────────────────────────────────
def square_pad(im, margin_pct, bg):
    """Center `im` on a square canvas with margin_pct padding on each side."""
    w, h = im.size
    side = int(round(max(w, h) * (1 + 2 * margin_pct)))
    canvas = Image.new('RGBA', (side, side), bg)
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im if im.mode == 'RGBA' else None)
    return canvas

TRANSPARENT = (255, 255, 255, 0)
WHITE = (255, 255, 255, 255)

mark_t = to_rgba(img.crop(mark_bbox))                       # A-mark, transparent
lock_t = to_rgba(img.crop(lockup_bbox))                     # full lockup, transparent

# mark on white tile (for the app-wide nokhba-mark.svg + maskable)
mark_w = Image.new('RGBA', mark_t.size, WHITE)
mark_w.paste(mark_t, (0, 0), mark_t)
# lockup on white
lock_w = Image.new('RGBA', lock_t.size, WHITE)
lock_w.paste(lock_t, (0, 0), lock_t)

def save(im, name, size=None):
    out = im if size is None else im.resize((size, size), Image.Resampling.LANCZOS)
    path = f'{PUB}/{name}'
    out.save(path, optimize=True)
    print(f'  {name:32s} {out.size[0]}x{out.size[1]} {out.mode}')

print('writing PNGs:')
save(square_pad(mark_t, 0.06, TRANSPARENT), 'favicon-64.png', 64)
save(square_pad(mark_t, 0.06, TRANSPARENT), 'favicon.png', 32)
save(square_pad(mark_t, 0.06, TRANSPARENT), 'logo-icon.png', 512)
save(square_pad(lock_w, 0.06, WHITE), 'logo-192.png', 192)
save(square_pad(lock_w, 0.06, WHITE), 'logo-512.png', 512)
save(square_pad(lock_w, 0.06, WHITE), 'logo.png', 512)
save(square_pad(lock_w, 0.06, WHITE), 'nokhba-logo.png', 512)
save(square_pad(lock_t, 0.06, TRANSPARENT), 'nokhba-logo-restored.png', 512)
save(square_pad(lock_t, 0.06, TRANSPARENT), 'nokhba-official-transparent.png', 512)

# maskable: mark inside PWA safe zone (circle d=80% → square side ≈ 55% of canvas)
safe_side = int(512 * 0.55)
mark_maskable = Image.new('RGBA', (512, 512), WHITE)
m = square_pad(mark_w, 0.0, WHITE).resize((safe_side, safe_side), Image.Resampling.LANCZOS)
mark_maskable.paste(m, ((512 - safe_side) // 2, (512 - safe_side) // 2), m)
save(mark_maskable, 'logo-maskable-512.png')

# ── SVG wrappers (embedded base64 PNG → pixel-perfect, zero redesign) ──────
def b64(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode('ascii')

def svg_doc(im, bg_note=''):
    """Embed at ≤512px source: these render at 32–64px in the UI, so 512 is
    ~8x DPR headroom while keeping file size sane."""
    if max(im.size) > 512:
        s = 512
        im = im.resize((s, s), Image.Resampling.LANCZOS)
    data = b64(im)
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'viewBox="0 0 {im.width} {im.height}" width="{im.width}" height="{im.height}" '
            f'role="img" aria-label="Alnokhba">'
            f'<image xlink:href="data:image/png;base64,{data}" '
            f'href="data:image/png;base64,{data}" width="{im.width}" height="{im.height}" '
            'preserveAspectRatio="xMidYMid meet"/></svg>')

print('writing SVGs:')
mark_tile = square_pad(mark_w, 0.06, WHITE)          # white tile, subtle inner margin
svg_mark = svg_doc(mark_tile)
with open(f'{PUB}/nokhba-mark.svg', 'w') as f:
    f.write(svg_mark)
print(f'  nokhba-mark.svg                {len(svg_mark)//1024} KB')

fav64 = square_pad(mark_t, 0.06, TRANSPARENT).resize((64, 64), Image.Resampling.LANCZOS)
svg_fav = svg_doc(fav64)
for name in ('favicon.svg',):
    with open(f'{PUB}/{name}', 'w') as f:
        f.write(svg_fav)
print(f'  favicon.svg                    {len(svg_fav)//1024} KB')

lock_svg = square_pad(lock_w, 0.06, WHITE)
for name in ('nokhba-logo.svg', 'nokhba-official.svg', 'logo.svg'):
    with open(f'{PUB}/{name}', 'w') as f:
        f.write(svg_doc(lock_svg))
print(f'  nokhba-logo.svg/official/logo  {len(svg_doc(lock_svg))//1024} KB each')

print('DONE')
