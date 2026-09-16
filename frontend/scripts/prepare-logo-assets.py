from pathlib import Path
from PIL import Image

root = Path('/home/ubuntu/supplied-frontend')
public = root / 'public'
src = public / 'nokhba-logo-restored.png'
img = Image.open(src).convert('RGBA')
pixels = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = pixels[x, y]
        # Remove the white matte while preserving the white negative spaces inside the mark.
        # Only pixels connected to the outside matte are removed below via flood fill.

# Flood-fill outside white/near-white pixels.
from collections import deque
q = deque()
seen = set()
for x in range(img.width):
    q.append((x, 0)); q.append((x, img.height - 1))
for y in range(img.height):
    q.append((0, y)); q.append((img.width - 1, y))
while q:
    x, y = q.popleft()
    if (x, y) in seen or x < 0 or y < 0 or x >= img.width or y >= img.height:
        continue
    seen.add((x, y))
    r, g, b, a = pixels[x, y]
    if min(r, g, b) < 238:
        continue
    pixels[x, y] = (r, g, b, 0)
    q.extend(((x+1,y),(x-1,y),(x,y+1),(x,y-1)))

bbox = img.getbbox()
if bbox:
    img = img.crop(bbox)
# Add balanced transparent padding for flexible placement.
pad = max(12, round(min(img.size) * 0.045))
canvas = Image.new('RGBA', (img.width + pad*2, img.height + pad*2), (0, 0, 0, 0))
canvas.alpha_composite(img, (pad, pad))
img = canvas

img.save(public / 'nokhba-logo.png', optimize=True)
img.save(public / 'logo-icon.png', optimize=True)
img.resize((64, 64), Image.Resampling.LANCZOS).save(public / 'favicon-64.png', optimize=True)
img.resize((192, 192), Image.Resampling.LANCZOS).save(public / 'logo-192.png', optimize=True)
img.resize((512, 512), Image.Resampling.LANCZOS).save(public / 'logo-512.png', optimize=True)

# SVG wrapper keeps a browser-readable vector container and transparent background.
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">NOKHBA logo</title><desc id="desc">NOKHBA graduation cap logo in navy and gold</desc><image href="/nokhba-logo.png" width="{w}" height="{h}" preserveAspectRatio="xMidYMid meet"/></svg>'''.format(w=img.width, h=img.height)
(public / 'nokhba-logo.svg').write_text(svg, encoding='utf-8')
print('created', img.size)
