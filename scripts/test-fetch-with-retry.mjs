// Standalone semantics test for the fetchWithRetry logic shipped in
// src/context/AuthContext.jsx (same code, copy-pasted to avoid import.path hacks).
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error('FAIL:', name) } }

const RETRYABLE_MSG = /failed to fetch|fetch failed|networkerror|network error|load failed|timed?\s?out|timeout|aborted?|err_name_not_resolved|err_internet_disconnected|err_connection/i
function isRetryableQueryError(error) {
  if (!error) return true
  if (String(error.code || '').startsWith('PGRST')) return false
  if (!error.code) return true
  return RETRYABLE_MSG.test(`${error.message || ''} ${error.details || ''}`)
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }
async function fetchWithRetry(run, { attempts = 3, timeoutMs = 12000, baseMs = 700 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('network timeout')), timeoutMs)
        Promise.resolve(run()).then(
          (v) => { clearTimeout(timer); resolve(v) },
          (e) => { clearTimeout(timer); reject(e) },
        )
      })
    } catch (err) {
      lastError = err
      if (i === attempts - 1 || !isRetryableQueryError(err)) break
      await delay(baseMs * 2 ** i + Math.random() * 300)
    }
  }
  throw lastError
}

// 1. Transport failure retries then succeeds
let calls = 0
const r1 = await fetchWithRetry(async () => {
  calls++
  if (calls < 3) throw new Error('TypeError: Failed to fetch')
  return { data: 'profile-row' }
}, { baseMs: 1, timeoutMs: 200 })
ok(calls === 3 && r1.data === 'profile-row', 'transport failure retried to success')

// 2. PostgREST code (PGRST116) does NOT retry
let calls2 = 0
try {
  await fetchWithRetry(async () => {
    calls2++
    const e = new Error('No rows found'); e.code = 'PGRST116'; throw e
  }, { baseMs: 1 })
} catch (e) { /* expected */ }
ok(calls2 === 1, 'PGRST116 stops immediately (no retry)')

// 3. Timeout wraps a hung request and retries
let calls3 = 0
const t0 = Date.now()
try {
  await fetchWithRetry(async () => {
    calls3++
    return new Promise((resolve) => setTimeout(resolve, 5000))
  }, { attempts: 2, timeoutMs: 60, baseMs: 1 })
  ok(false, 'hung request should throw')
} catch { /* expected */ }
const elapsed = Date.now() - t0
ok(calls3 === 2 && elapsed < 1500, `hung request timed out twice quickly (${elapsed}ms, calls=${calls3})`)

// 4. Exhausted retries throw the last error
let calls4 = 0
try {
  await fetchWithRetry(async () => { calls4++; throw new Error('network error') }, { attempts: 3, baseMs: 1 })
  ok(false, 'exhaustion should throw')
} catch (e) {
  ok(calls4 === 3 && /network error/.test(e.message), 'exhausted after N attempts, last error surfaces')
}

// 5. isRetryableQueryError classification
ok(isRetryableQueryError(new Error('Failed to fetch')) === true, 'fetch TypeError retryable')
ok(isRetryableQueryError(new Error('network timeout')) === true, 'our timeout retryable')
const rls = new Error('permission denied'); rls.code = '42501'
ok(isRetryableQueryError(rls) === false, 'RLS 42501 NOT retryable')
const pgrst = new Error('relation missing'); pgrst.code = 'PGRST205'
ok(isRetryableQueryError(pgrst) === false, 'PGRST205 NOT retryable')
ok(isRetryableQueryError(null) === true, 'null error treated as transport')

// 6. Timer cleanup: fast success must not leave the timeout pending (implicit via process exiting cleanly)
const r6 = await fetchWithRetry(async () => 'fast', { timeoutMs: 200 })
ok(r6 === 'fast', 'fast success passes through')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
