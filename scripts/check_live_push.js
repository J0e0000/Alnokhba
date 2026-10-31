// Check live deployed bundle for auto push-permission prompt on student portal
const BASE = 'https://al-nokhbba.vercel.app'

async function getText(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}

const html = await getText(BASE + '/')
const entry = (html.match(/assets\/index-[\w-]+\.js/) || [])[0]
console.log('entry:', entry)
const entryJs = await getText(`${BASE}/${entry}`)

// collect all chunk refs from entry
const chunks = new Set()
const re = /[\w./-]*assets\/[\w-]+\.js/g
for (const m of entryJs.matchAll(re)) chunks.add(m[0].replace(/^\.\//, ''))
// also relative refs like "./PublicQRPage-xxx.js"
for (const m of entryJs.matchAll(/"(\.\/[\w-]+-[A-Za-z0-9_-]{8}\.js)"/g)) chunks.add('assets/' + m[1].slice(2))
console.log('total chunks:', chunks.size)

let found = 0
for (const c of chunks) {
  let js
  try { js = await getText(`${BASE}/${c}`) } catch { continue }
  if (js.includes('requestPermission') || js.includes('\u062a\u0641\u0639\u064a\u0644 \u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0648\u0644\u064a \u0627\u0644\u0623\u0645\u0631')) {
    found++
    console.log('--- HIT:', c)
    // find context around requestPermission
    for (const m of js.matchAll(/requestPermission/g)) {
      const i = m.index
      console.log('   ctx:', JSON.stringify(js.slice(Math.max(0, i - 220), i + 60)).slice(0, 400))
    }
  }
}
if (!found) console.log('no chunk contains requestPermission or the portal push button text')
