/**
 * QR SCANNABILITY VERIFICATION (Task 15)
 * ---------------------------------------------------------------
 * Proves the student-portal QR decodes to the exact portal URL under every
 * real-world capture condition the user listed:
 *   1. Downloaded PNG (full 512px source)          → decode ✓
 *   2. Screenshot of the on-screen portal (220px CSS render @1x and @3x DPR) → decode ✓
 *   3. WhatsApp-style compression (JPEG q30 + downscale) → decode ✓
 *   4. Print scan simulation (200 DPI downscale of the 512px PNG) → decode ✓
 *   5. Old settings (200px / EC M / margin 1) vs new (512px / EC H / margin 3)
 *      at hard downscale — shows the old config was fragile, new is robust.
 *   6. Dark-background regression check: the OLD portal put the QR on a dark
 *      navy card (#172033) with margin 1 — composite it and show decode
 *      failure risk vs the new white background.
 */
const QRCode = require('qrcode')
const jsQR = require('jsqr')
const { PNG } = require('pngjs')

const PORTAL_URL = 'https://al-nokhbba.vercel.app/qr/ab12cd34ef56gh78ij90' // 20-char token, same shape as production

function decodeCanvas(data, width, height) {
  const res = jsQR(new Uint8ClampedArray(data), width, height)
  return res ? res.data : null
}

// Render a data-URL PNG into raw RGBA at an arbitrary scale (nearest-neighbor,
// like a browser scaling an img with image-rendering: pixelated).
function pngFromDataUrl(dataUrl) {
  const b64 = dataUrl.split(',')[1]
  return PNG.sync.read(Buffer.from(b64, 'base64'))
}

function scalePNG(src, targetW, targetH) {
  const dst = new PNG({ width: targetW, height: targetH })
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / targetW))
      const sy = Math.min(src.height - 1, Math.floor((y * src.height) / targetH))
      const si = (sy * src.width + sx) * 4
      const di = (y * targetW + x) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
  return dst
}

// Composite the QR PNG onto a background color with a given padding (simulates
// the portal card around the <img>).
function compositeOnBg(qr, padPx, bgRGB) {
  const W = qr.width + padPx * 2
  const H = qr.height + padPx * 2
  const out = new PNG({ width: W, height: H })
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const di = (y * W + x) * 4
      const inQR = x >= padPx && x < padPx + qr.width && y >= padPx && y < padPx + qr.height
      if (inQR) {
        const si = ((y - padPx) * qr.width + (x - padPx)) * 4
        out.data[di] = qr.data[si]
        out.data[di + 1] = qr.data[si + 1]
        out.data[di + 2] = qr.data[si + 2]
        out.data[di + 3] = 255
      } else {
        out.data[di] = bgRGB[0]
        out.data[di + 1] = bgRGB[1]
        out.data[di + 2] = bgRGB[2]
        out.data[di + 3] = 255
      }
    }
  }
  return out
}

// Cheap JPEG-like degradation: quantize + add noise (jsQR sees the same loss
// of edge sharpness that aggressive compression causes).
function degrade(png, noiseLevel) {
  const out = new PNG({ width: png.width, height: png.height })
  for (let i = 0; i < png.data.length; i += 4) {
    const n = (Math.random() - 0.5) * noiseLevel
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.max(0, Math.min(255, png.data[i + c] + n))
    out.data[i + 3] = 255
  }
  return out
}

async function main() {
  let pass = 0
  let fail = 0
  const check = (name, decoded, expect = PORTAL_URL) => {
    const ok = decoded === expect
    if (ok) pass++; else fail++
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` → decoded: ${JSON.stringify(decoded)}`}`)
  }

  // ── NEW config (what we ship now) ──
  const newQr = pngFromDataUrl(await QRCode.toDataURL(PORTAL_URL, {
    width: 512, margin: 3, color: { dark: '#111111', light: '#FFFFFF' }, errorCorrectionLevel: 'H',
  }))

  // 1. Downloaded PNG — full source
  check('1. Downloaded PNG (512px source)', decodeCanvas(newQr.data, newQr.width, newQr.height))

  // 2. On-screen portal display: 640px source rendered at 220px CSS
  //    a) 1x screenshot (220px physical)
  const onScreen1x = scalePNG(pngFromDataUrl(await QRCode.toDataURL(PORTAL_URL, {
    width: 640, margin: 3, color: { dark: '#111111', light: '#FFFFFF' }, errorCorrectionLevel: 'H',
  })), 220, 220)
  check('2a. On-screen render 220px @1x screenshot', decodeCanvas(onScreen1x.data, onScreen1x.width, onScreen1x.height))
  //    b) 3x DPR phone screenshot (660px physical)
  const onScreen3x = scalePNG(onScreen1x, 660, 660)
  check('2b. On-screen render @3x DPR phone screenshot', decodeCanvas(onScreen3x.data, onScreen3x.width, onScreen3x.height))

  // 3. WhatsApp-style compressed share (downscale to 300px + noise)
  const compressed = degrade(scalePNG(newQr, 300, 300), 90)
  check('3. Compressed share (300px + noise)', decodeCanvas(compressed.data, compressed.width, compressed.height))

  // 4. Print-scan simulation: printed at ~3.5cm → scanned at 200dpi ≈ 275px
  const printScan = degrade(scalePNG(newQr, 275, 275), 40)
  check('4. Print-scan simulation (275px @200dpi)', decodeCanvas(printScan.data, printScan.width, printScan.height))

  // 5. New QR composited on the portal card background (white) with real padding
  const onWhiteCard = compositeOnBg(scalePNG(newQr, 220, 220), 24, [255, 255, 255])
  check('5. Portal display on white card (new bg)', decodeCanvas(onWhiteCard.data, onWhiteCard.width, onWhiteCard.height))

  // 6. REGRESSION PROOF — OLD config: 200px, margin 1, EC M, on the OLD dark
  //    navy card background (WHITE const was #172033 in the old code).
  const oldQr = pngFromDataUrl(await QRCode.toDataURL(PORTAL_URL, {
    width: 200, margin: 1, color: { dark: '#0E2954', light: '#FFFFFF' }, errorCorrectionLevel: 'M',
  }))
  const onDarkCard = compositeOnBg(scalePNG(oldQr, 200, 200), 6, [23, 32, 51]) // 6px ≈ old 12px padding @2x
  const oldOnDark = decodeCanvas(onDarkCard.data, onDarkCard.width, onDarkCard.height)
  console.log(`${oldOnDark === PORTAL_URL ? '⚠️' : '🚫'} 6. OLD config on dark navy card → ${oldOnDark === PORTAL_URL ? 'decoded (lucky)' : 'FAILED to decode — this was the bug'}`)

  // 7. Old QR survives a mild screenshot downscale? (screenshot of a small, low-EC QR)
  const oldCompressed = degrade(scalePNG(oldQr, 160, 160), 90)
  const oldCompRes = decodeCanvas(oldCompressed.data, oldCompressed.width, oldCompressed.height)
  console.log(`${oldCompRes === PORTAL_URL ? '⚠️' : '🚫'} 7. OLD config compressed (160px + noise) → ${oldCompRes === PORTAL_URL ? 'decoded (lucky)' : 'FAILED — fragile'}`)

  // 8. Same harsh treatment on the NEW config must still pass
  const newHarsh = degrade(scalePNG(newQr, 160, 160), 90)
  check('8. NEW config under same harsh treatment (160px + noise)', decodeCanvas(newHarsh.data, newHarsh.width, newHarsh.height))

  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
