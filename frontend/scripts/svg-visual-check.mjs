#!/usr/bin/env node
/* Visual A/B check for the optimized nokhba-mark.svg:
   renders original + optimized side by side at 96px and 512px (light & dark
   backgrounds) and reports mean pixel difference. */
import { chromium } from 'playwright'
import fs from 'node:fs'

const orig = fs.readFileSync('/tmp/nokhba-mark-original.svg', 'utf8')
const opt = fs.readFileSync(process.argv[2] || '/tmp/nokhba-mark-p2.svg', 'utf8')

const html = `<!doctype html><html><body style="margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0">
${[96, 512].flatMap((s) => [
  `<div style="background:#ffffff;padding:8px"><img id="o${s}" width="${s}" height="${s}" src="data:image/svg+xml;base64,${Buffer.from(orig).toString('base64')}"></div>`,
  `<div style="background:#ffffff;padding:8px"><img id="n${s}" width="${s}" height="${s}" src="data:image/svg+xml;base64,${Buffer.from(opt).toString('base64')}"></div>`,
  `<div style="background:#172033;padding:8px"><img id="od${s}" width="${s}" height="${s}" src="data:image/svg+xml;base64,${Buffer.from(orig).toString('base64')}"></div>`,
  `<div style="background:#172033;padding:8px"><img id="nd${s}" width="${s}" height="${s}" src="data:image/svg+xml;base64,${Buffer.from(opt).toString('base64')}"></div>`,
]).join('')}
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.setContent(html)
await page.waitForTimeout(800)
// compare pairs via canvas
const result = await page.evaluate(async () => {
  async function diff(idA, idB) {
    const a = document.getElementById(idA), b = document.getElementById(idB)
    const s = a.width
    const cv = document.createElement('canvas'); cv.width = s; cv.height = s
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(a, 0, 0, s, s)
    const dA = ctx.getImageData(0, 0, s, s).data
    ctx.clearRect(0, 0, s, s)
    ctx.drawImage(b, 0, 0, s, s)
    const dB = ctx.getImageData(0, 0, s, s).data
    let sum = 0, max = 0
    for (let i = 0; i < dA.length; i += 4) {
      const d = Math.abs(dA[i] - dB[i]) + Math.abs(dA[i + 1] - dB[i + 1]) + Math.abs(dA[i + 2] - dB[i + 2])
      sum += d
      if (d > max) max = d
    }
    return { mean: +(sum / (dA.length / 4) / 3).toFixed(3), max }
  }
  const pairs = {}
  for (const s of [96, 512]) {
    pairs[`light_${s}`] = await diff(`o${s}`, `n${s}`)
    pairs[`dark_${s}`] = await diff(`od${s}`, `nd${s}`)
  }
  return pairs
})
console.log(JSON.stringify(result, null, 2))
// save side-by-side screenshots for manual check
await page.screenshot({ path: '/tmp/svg-compare.png', fullPage: true })
await browser.close()
