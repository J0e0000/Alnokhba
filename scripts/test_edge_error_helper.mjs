// Unit test for describeEdgeFunctionError — simulates the exact error shapes
// supabase-js produces for edge-function failures (FunctionsHttpError carries
// the Response in .context; FunctionsFetchError has only a message).
import { describeEdgeFunctionError } from '../src/lib/edgeFunctionErrors.js'

const httpError = (status, body, contentType = 'application/json') => {
  const err = new Error('Edge Function returned a non-2x status code')
  err.context = new Response(body, { status, headers: { 'content-type': contentType } })
  return err
}

const cases = [
  {
    name: 'old deployed function → Unsupported action (fallback must still match)',
    error: httpError(400, JSON.stringify({ error: 'Unsupported action' })),
    expect: (e) => e.message === 'Unsupported action',
  },
  {
    name: 'rate limit 429',
    error: httpError(429, JSON.stringify({ error: 'Too many admin operations — try again in a few minutes' })),
    expect: (e) => e.status === 429 && e.message.includes('محاولات كثيرة'),
  },
  {
    name: 'unauthorized 401',
    error: httpError(401, JSON.stringify({ error: 'Unauthorized' })),
    expect: (e) => e.message.includes('سجّل الدخول'),
  },
  {
    name: 'admin access 403',
    error: httpError(403, JSON.stringify({ error: 'Admin access required' })),
    expect: (e) => e.message.includes('للأدمن فقط'),
  },
  {
    name: 'missing config 500',
    error: httpError(500, JSON.stringify({ error: 'Server configuration is incomplete' })),
    expect: (e) => e.message.includes('إعدادات admin-account-actions ناقصة'),
  },
  {
    name: 'migration_049 infra missing (hint appended, detail kept)',
    error: httpError(500, JSON.stringify({ error: 'function admin_log_audit does not exist' })),
    expect: (e) => e.message.includes('admin_log_audit does not exist') && e.message.includes('migration_049'),
  },
  {
    name: 'renewals table missing (hint appended)',
    error: httpError(400, JSON.stringify({ error: 'relation "subscription_renewals" does not exist' })),
    expect: (e) => e.message.includes('subscription_renewals') && e.message.includes('سجل التجديدات'),
  },
  {
    name: 'function not deployed (gateway 404)',
    error: httpError(404, 'Function not found', 'text/plain'),
    expect: (e) => e.notDeployed === true && e.message.includes('غير منشورة'),
  },
  {
    name: 'fetch-level failure (FunctionsFetchError shape)',
    error: (() => { const e = new Error('Failed to send request to Supabase Edge Function'); return e })(),
    expect: (e) => e.notDeployed === true,
  },
  {
    name: 'function 404 with business body NOT misread as not-deployed',
    error: httpError(404, JSON.stringify({ error: 'Renewal record not found' })),
    expect: (e) => e.notDeployed === false && e.message.includes('Renewal record not found'),
  },
  {
    name: 'plain-text non-JSON body',
    error: httpError(502, 'Bad gateway', 'text/plain'),
    expect: (e) => e.message === 'Bad gateway',
  },
  {
    name: 'unreadable body → generic fallback',
    error: (() => { const e = new Error('Edge Function returned a non-2x status code'); e.context = { status: 500, text: () => { throw new Error('stream closed') } }; return e })(),
    expect: (e) => e.message.includes('non-2x') && e.status === 500,
  },
]

let pass = 0
for (const c of cases) {
  const e = await describeEdgeFunctionError(c.error, { functionName: 'admin-account-actions' })
  const ok = c.expect(e)
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${c.name}`)
  if (!ok) { console.log('   got:', JSON.stringify({ msg: e.message, status: e.status, notDeployed: e.notDeployed })); process.exitCode = 1 } else pass++
}
console.log(`\n${pass}/${cases.length} passed`)
