#!/usr/bin/env python3
"""Single composite proof sheet for the relay attachment:
top = the 4 card styles (front + mirrored back each), bottom = students page."""
from PIL import Image

OUT = '/home/z/my-project/download/screenshots'
W = 1200
cards = Image.open(f'{OUT}/card-styles-A-to-D.png')
students = Image.open(f'{OUT}/students-desktop.png')

cw = W
ch = round(cards.height * W / cards.width)
cards_r = cards.resize((cw, ch), Image.LANCZOS).convert('RGB')
sw = W
sh = round(students.height * W / students.width)
students_r = students.resize((sw, sh), Image.LANCZOS).convert('RGB')

GAP = 16
sheet = Image.new('RGB', (W, ch + GAP + sh), '#FFFFFF')
sheet.paste(cards_r, (0, 0))
sheet.paste(students_r, (0, ch + GAP))
out = f'{OUT}/proof-sheet.jpg'
sheet.save(out, quality=82, optimize=True)
import os
print(out, sheet.size, os.path.getsize(out), 'bytes')
