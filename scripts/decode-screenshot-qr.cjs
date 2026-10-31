/** Decode the portal QR from a REAL browser screenshot (on-screen scan simulation). */
const jsQR = require('jsqr')
const { PNG } = require('pngjs')
const fs = require('fs')

const file = process.argv[2]
const png = PNG.sync.read(fs.readFileSync(file))
// Try full image first, then common crops
const attempts = []
const decode = (label, img) => {
  const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)
  attempts.push(`${res ? '✅' : '—'} ${label}: ${res ? res.data : 'no decode'}`)
  return res
}

let hit = decode(`full screenshot ${png.width}x${png.height}`, png)
if (!hit) {
  // slide a crop window over the center region
  for (const size of [0.5, 0.4, 0.3, 0.25].map((f) => Math.floor(Math.min(png.width, png.height) * f))) {
    outer: for (let oy = 0; oy + size <= png.height; oy += Math.floor(size / 4)) {
      for (let ox = 0; ox + size <= png.width; ox += Math.floor(size / 4)) {
        const crop = new PNG({ width: size, height: size })
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const si = ((oy + y) * png.width + (ox + x)) * 4
            const di = (y * size + x) * 4
            for (let c = 0; c < 4; c++) crop.data[di + c] = png.data[si + c]
          }
        }
        const res = jsQR(new Uint8ClampedArray(crop.data), crop.width, crop.height)
        if (res) { hit = res; break outer }
      }
    }
    if (hit) { attempts.push(`   (found in ${size}px crop window)`) ; break }
  }
}

attempts.forEach((l) => console.log(l))
console.log(hit ? `\n═══ ON-SCREEN QR DECODES TO: ${hit.data} ═══` : '\n═══ FAILED ═══')
process.exit(hit ? 0 : 1)
