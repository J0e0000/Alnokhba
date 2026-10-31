// Production sanity probe for the QR attendance server contract.
// Extracts the PUBLIC anon key from the live bundle (it ships to every
// browser by design) and probes REST endpoints. NEVER prints the key.
const SITE = 'https://al-nokhbba.vercel.app'

async function getText(url) {
  return (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
}

async function main() {
  const html = await getText(SITE + '/')
  const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
  if (!entry) throw new Error('no entry bundle in index.html')
  const js = await getText(SITE + entry)
  const clientChunk = js.match(/(assets\/supabaseClient-[\w-]+\.js)/)?.[1]
  if (!clientChunk) throw new Error('no supabaseClient chunk referenced')
  const client = await getText(`${SITE}/${clientChunk}`)
  const base = client.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0]
  const key = client.match(/`?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)`?/)?.[1]
  if (!base || !key) throw new Error('could not extract supabase config from client chunk')
  console.log('supabase project:', base.replace('https://', '').split('.')[0])
  console.log('anon key found:', key.length, 'chars (not printed)')

  const rest = (path, init = {}) => fetch(base + path, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  }).then(async (r) => ({ status: r.status, body: await r.text().then((t) => t.slice(0, 240)) }))

  // 1) resolve_student_by_qr exists? anon is revoked → expect a permission
  //    error (42501/403/PGRST), NOT "function not found" (PGRST202/404).
  const rpc = await rest('/rest/v1/rpc/resolve_student_by_qr', {
    method: 'POST',
    body: JSON.stringify({ p_payload: 'probe-nonexistent-token-123456' }),
  })
  const missingFn = /PGRST202|Could not find the function|schema_cache/i.test(rpc.body)
  console.log('[resolve_student_by_qr]', rpc.status, missingFn ? 'MISSING (needs migration!)' : 'present (anon correctly denied)')

  // 2) upsert_lesson_attendance exists?
  const rpc2 = await rest('/rest/v1/rpc/upsert_lesson_attendance', {
    method: 'POST',
    body: JSON.stringify({ p_lesson_session_id: '00000000-0000-0000-0000-000000000000', p_student_id: '00000000-0000-0000-0000-000000000000', p_status: 'حاضر' }),
  })
  const missingFn2 = /PGRST202|Could not find the function|schema_cache/i.test(rpc2.body)
  console.log('[upsert_lesson_attendance]', rpc2.status, missingFn2 ? 'MISSING (needs migration!)' : 'present (anon correctly denied)')

  // 3) teacher_notification_events table + RLS: expect 200 with [] for anon.
  const t = await rest('/rest/v1/teacher_notification_events?select=id&limit=1')
  console.log('[teacher_notification_events]', t.status, t.status === 200 ? 'table exists, RLS filters anon (expected [])' : 'unexpected — see body')
  console.log('   body:', t.body)
}

main().catch((e) => { console.error('probe failed:', e.message); process.exit(1) })
