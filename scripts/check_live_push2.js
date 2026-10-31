// Deep-check: where does requestPermission live in the LIVE bundle, and is registerStudentPush auto-called on portal load?
const BASE = 'https://al-nokhbba.vercel.app'
async function getText(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}
const html = await getText(BASE + '/')
const entry = (html.match(/assets\/index-[\w-]+\.js/) || [])[0]
for (const [name, url] of [['entry', `${BASE}/${entry}`], ['portal', `${BASE}/assets/PublicQRPage-BrwAOE0-.js`]]) {
  const js = await getText(url)
  console.log(`=== ${name} (${url}) size=${js.length}`)
  for (const pat of ['requestPermission', 'registerStudentPush', 'registerTeacherPush', 'pushManager.subscribe', 'serviceWorker.register']) {
    let idx = js.indexOf(pat), n = 0
    while (idx !== -1 && n < 4) {
      console.log(`  [${pat}] ctx: ${JSON.stringify(js.slice(Math.max(0, idx - 260), idx + 90)).slice(0, 520)}`)
      idx = js.indexOf(pat, idx + 1); n++
    }
    if (n === 0) console.log(`  [${pat}] NOT FOUND`)
  }
}
