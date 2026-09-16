/**
 * Static analysis test — verifies that every Supabase SELECT query in the
 * frontend is scoped by teacher_id (defense-in-depth against RLS misconfig).
 *
 * This test does NOT connect to Supabase. It parses the frontend source
 * files and asserts that any `supabase.from('<table>').select(...)` call
 * on a tenant-owned table is followed by `.eq('teacher_id', ...)`.
 *
 * Run with:  node /home/z/my-project/audit/al-fares-saas/frontend/tests/static-isolation-check.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '..', 'src')

// Tables that are tenant-owned and MUST be filtered by teacher_id on every
// teacher-side SELECT. (student_qr_tokens is OK to read without teacher_id
// because the token itself is the secret.)
const TENANT_TABLES = new Set([
  'students',
  'attendance_records',
  'behavior_logs',
  'teacher_settings',
  'exams',
  'exam_scores',
  'session_logs',
  'group_schedule',
  'announcements',
  'homework_tasks',
  'homework_task_status',
  'feature_unlocks',
])

function listJsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listJsFiles(full, acc)
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

// Extract the first string literal from a code fragment like .from('students')
function extractTableName(argStr) {
  const m = argStr.match(/^\s*['"`]([^'"`]+)['"`]/)
  return m ? m[1] : null
}

// Walk a single .from('table') call chain and return the list of chained
// method names + their first arg, so we can check whether `.eq('teacher_id', ...)`
// appears in the chain.
function parseFromChain(content, fromIdx) {
  // Find the matching closing parenthesis of .from(...)
  let i = content.indexOf('(', fromIdx) + 1
  let depth = 1
  let arg = ''
  while (i < content.length && depth > 0) {
    const c = content[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    if (depth > 0) arg += c
    i++
  }
  const table = extractTableName(arg)
  if (!table) return null

  // Walk the rest of the chain.
  let j = i
  const remaining = content.slice(j, j + 2000) // generous window
  let chain = []
  let pos = 0
  while (pos < remaining.length) {
    while (pos < remaining.length && /\s/.test(remaining[pos])) pos++
    if (remaining[pos] !== '.') break
    pos++
    let name = ''
    while (pos < remaining.length && /[a-zA-Z0-9_$]/.test(remaining[pos])) {
      name += remaining[pos]; pos++
    }
    while (pos < remaining.length && /\s/.test(remaining[pos])) pos++
    if (remaining[pos] !== '(') break
    pos++
    let a = ''
    let d = 1
    while (pos < remaining.length && d > 0) {
      const c = remaining[pos]
      if (c === '(') d++
      else if (c === ')') d--
      if (d > 0) a += c
      pos++
    }
    chain.push({ name, arg: a })
    if (['then', 'catch', 'finally'].includes(name)) break
    if (/;\s*$/.test(a) || /\bawait\b/.test(a)) break
  }
  return { table, chain }
}

function findFromCalls(content) {
  const results = []
  const fromRegex = /\.from\s*\(/g
  let m
  while ((m = fromRegex.exec(content)) !== null) {
    const parsed = parseFromChain(content, m.index)
    if (parsed) results.push({ index: m.index, ...parsed })
  }
  return results
}

function lineOf(content, idx) {
  let line = 1
  for (let i = 0; i < idx && i < content.length; i++) {
    if (content[i] === '\n') line++
  }
  return line
}

function main() {
  const files = listJsFiles(SRC_DIR)
  const violations = []
  const checked = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const calls = findFromCalls(content)
    for (const call of calls) {
      const { table, chain, index } = call
      if (!TENANT_TABLES.has(table)) continue

      const isPortal = /PublicQRPage\.jsx$/.test(file)

      if (isPortal) {
        // The portal MUST use the RPC for tenant tables.
        violations.push({
          file,
          line: lineOf(content, index),
          table,
          reason: 'PublicQRPage.jsx must use supabase.rpc("get_student_portal_data") instead of direct table reads on tenant-owned tables',
        })
        continue
      }

      // AdminDashboard.jsx legitimately needs to read feature_unlocks across
      // ALL teachers (the admin manages feature unlocks for every teacher).
      // The RLS policy "feature_unlocks_read" allows:
      //   can_access_workspace(teacher_id) OR is_admin_user()
      // So an admin user can read all rows. This is by design.
      const isAdminFeatureUnlocks = /AdminDashboard\.jsx$/.test(file) && table === 'feature_unlocks'
      if (isAdminFeatureUnlocks) {
        checked.push({ file: path.basename(file), table, line: lineOf(content, index), note: 'admin' })
        continue
      }

      const hasTeacherIdFilter = chain.some(
        (c) => c.name === 'eq' && /^['"]teacher_id['"]/.test(c.arg.trim())
      )

      const isWrite = chain.some((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.name))

      if (!hasTeacherIdFilter && !isWrite) {
        violations.push({
          file,
          line: lineOf(content, index),
          table,
          chain: chain.map((c) => `.${c.name}(${c.arg.slice(0, 60)})`).join(''),
        })
      } else {
        checked.push({ file: path.basename(file), table, line: lineOf(content, index) })
      }
    }
  }

  console.log('══════════════════════════════════════════════════════════════════')
  console.log(' Static Isolation Check — Supabase query scoping audit')
  console.log('══════════════════════════════════════════════════════════════════')
  console.log(` Files scanned:        ${files.length}`)
  console.log(` Queries checked:      ${checked.length + violations.length}`)
  console.log(` Queries OK:           ${checked.length}`)
  console.log(` Violations:           ${violations.length}`)
  console.log('──────────────────────────────────────────────────────────────────')

  if (violations.length === 0) {
    console.log(' \u2713 PASS — every tenant-table SELECT is scoped by teacher_id.')
    process.exit(0)
  }

  console.log(' \u2717 FAIL — the following queries are NOT scoped by teacher_id:\n')
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  \u2192  supabase.from('${v.table}')`)
    if (v.chain) console.log(`     chain: ${v.chain}`)
    if (v.reason) console.log(`     reason: ${v.reason}`)
    console.log('')
  }
  process.exit(1)
}

main()
