#!/usr/bin/env python3
"""Render the 4 captured card-style PDFs and compose a labeled contact sheet:
one FRONT face + one BACK face per style (A-D), cropped to a single card."""
import os
import subprocess
import sys

from PIL import Image, ImageDraw

OUT = '/home/z/my-project/download/screenshots'
TMP = '/tmp/cards_render'
os.makedirs(TMP, exist_ok=True)

# 1) render first front page + first back page of each style PDF
for i, letter in enumerate('ABCD'):
    pdf = f'{OUT}/cards-style-{letter}.pdf'
    subprocess.run(['pdftoppm', '-png', '-r', '110', '-f', '1', '-l', '1', pdf, f'{TMP}/{letter}f'], check=True)
    subprocess.run(['pdftoppm', '-png', '-r', '110', '-f', '3', '-l', '3', pdf, f'{TMP}/{letter}b'], check=True)

def first_match(prefix):
    for f in sorted(os.listdir(TMP)):
        if f.startswith(prefix) and f.endswith('.png'):
            return os.path.join(TMP, f)
    sys.exit(f'missing render {prefix}')

# 2) crop card #1 (top-left card incl. cut margin) from each rendered page;
#    the BACK is cropped top-RIGHT — backs print row-mirrored for duplex, so
#    the right-hand card is the back of the top-LEFT front (same student).
def crop_card(path, mirrored=False):
    im = Image.open(path)
    w, h = im.size
    # 2 columns × 4 rows per page; take the top card with its dashed margin
    cw, ch = w // 2, h // 4
    if mirrored:
        return im.crop((cw, 0, w, ch))
    return im.crop((0, 0, cw, ch))

# 3) compose the sheet: 4 rows × 2 cols + label gutter
cards = []
for letter in 'ABCD':
    front = crop_card(first_match(f'{letter}f'))
    back = crop_card(first_match(f'{letter}b'), mirrored=True)
    cards.append((letter, front, back))

cw = max(c.width for _, f, b in cards for c in (f, b))
ch = max(c.height for _, f, b in cards for c in (f, b))
GUT, LBL = 24, 70
sheet = Image.new('RGB', (GUT * 3 + cw * 2 + LBL, GUT * 5 + ch * 4 + 30), '#F6F4EF')
d = ImageDraw.Draw(sheet)
cols = ['FRONT', 'BACK (QR — mirrored position, duplex long-edge flip)']
for j, t in enumerate(cols):
    d.text((GUT + cw * j + 40, GUT - 2), t, fill='#142D62')
for i, (letter, front, back) in enumerate(cards):
    y = GUT + (ch + GUT) * i + ch // 2
    d.text((8, y), f'STYLE {letter}', fill='#B8860B')
    sheet.paste(front, (LBL, GUT + 26 + (ch + GUT) * i))
    sheet.paste(back, (LBL + GUT + cw, GUT + 26 + (ch + GUT) * i))

out = f'{OUT}/card-styles-A-to-D.png'
sheet.save(out, optimize=True)
print('sheet:', out, sheet.size, os.path.getsize(out), 'bytes')
for f in sorted(os.listdir(OUT)):
    print(' ', f, os.path.getsize(os.path.join(OUT, f)))
