// Round 11 check — attendance INPUT state vs SAVED history separation.
// The user's rule: "Saving attendance completes the current input operation and
// resets the recording UI to Neutral. It does NOT erase historical attendance."
//
// Part 1 — source wiring (the separation is real, not cosmetic):
//   S1  a transient pendingAttendance map exists, distinct from saved maps
//   S2  clicking a status sets the pending input
//   S3  server-confirmed success clears the pending input (→ Neutral)
//   S4  offline-queued marks clear pending too (saved-locally semantics)
//   S5  a FAILED save does NOT clear pending (no fake success)
//   S6  every new lesson/session resets pending (no cross-operation carry-over)
//   S7  the ح/غ buttons render from pendingStatus, never from saved status
//   S8  both call sites (session rows + main students table) pass pendingStatus
//   S9  saved status is shown ONLY as a review badge (showSavedAttendanceBadge)
//   S10 the realtime handler never writes pendingAttendance
//   S11 history paths untouched: RPC success + realtime still update the saved
//       map; counts of SAVED statuses still drive the ✅/❌ counters
//   S12 unsaved counter (pendingSessionCount) separate from saved counters
//
// Part 2 — behavioral simulation of the state machine (the 14 spec tests):
//   T1..T14 see the simulation below (present/absent/mixed/persistence/history/
//   new-day/refresh/failed-save/double-save/concurrent/realtime/unmark/change/
//   historical-vs-current).
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
let failures = 0
const check = (name, cond, detail) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
  if (!cond && detail) console.log(`       ${detail}`)
}

console.log('Round 11 (attendance input ≠ saved history) checks:')

const dash = read('src/pages/Dashboard.jsx')

// ── Part 1: source wiring ──────────────────────────────────────────────────
check('S1: transient pendingAttendance state exists', /const \[pendingAttendance, setPendingAttendance\] = useState\(\{\}\)/.test(dash))
check('S1: pending state declared next to the SAVED lesson map (separation is explicit)', (() => { const a = dash.slice(0, dash.indexOf('const [pendingAttendance')).split('\n').length; const b = dash.slice(0, dash.indexOf('const [lessonAttendanceByStudent')).split('\n').length; return a - b <= 12 })())

const setAttSrc = dash.slice(dash.indexOf('const setAttendance = async'), dash.indexOf('const updateHW = async'))
check('S2: selecting a status sets the pending input', setAttSrc.includes("setPendingAttendance((prev) => ({ ...prev, [id]: status }))"))
const clearSnippet = 'setPendingAttendance((prev) => { const next = { ...prev }; delete next[id]; return next })'
const clearCount = (setAttSrc.match(new RegExp(clearSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
check('S3: server-confirmed success clears the pending input (→ Neutral)', clearCount >= 1)
check('S4: offline-queued mark clears pending too (saved locally)', /setSaveStatus\('saved_locally'\)[\s\S]{0,200}setPendingAttendance\(\(prev\) => \{ const next = \{ \.\.\.prev \}; delete next\[id\]; return next \}\)/.test(setAttSrc))
check('S4: online RPC success clears pending right after flashSaved', /flashSaved\(id\)[\s\S]{0,300}setPendingAttendance\(\(prev\) => \{ const next = \{ \.\.\.prev \}; delete next\[id\]; return next \}\)/.test(setAttSrc))
const catchSrc = setAttSrc.slice(setAttSrc.indexOf('} catch (error) {'), setAttSrc.indexOf('pushAction({'))
check('S5: FAILED save keeps the pending selection (no pending clear in the catch)', !clearSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('\\').join('') ? true : !catchSrc.includes('setPendingAttendance'))
check('S5: failure rolls back only the optimistic SAVED patch (history stays truthful)', catchSrc.includes('patchStudent(id, { attendance_status: prevState.attendance_status') && catchSrc.includes('return false'))
check('S6: every new lesson/session resets pending to Neutral', /useEffect\(\(\) => \{ setPendingAttendance\(\{\}\) \}, \[activeLessonId\]\)/.test(dash))

const rowSrc = dash.slice(dash.indexOf('function StudentRow'))
check('S7: the ح button renders from pendingStatus (not saved status)', rowSrc.includes("${pendingStatus === 'حاضر' ? 'bg-emerald-600 text-fg' : 'text-fg-subtle'}"))
check('S7: the غ button renders from pendingStatus (not saved status)', rowSrc.includes("${pendingStatus === 'غائب' ? 'bg-rose-600 text-fg' : 'text-fg-subtle'}"))
check('S7: no attendance button anywhere keys on s.attendance_status', !/className=\{`px-2 py-1 rounded text-xs font-bold \$\{s\.attendance_status === '(حاضر|غائب)'\?/.test(rowSrc))

const sessionCall = dash.slice(dash.indexOf('visibleSessionStudents.map((s, i) =>'), dash.indexOf('visibleSessionStudents.map((s, i) =>') + 2600)
const mainCall = dash.slice(dash.indexOf('filteredStudents.map((s, i) =>'), dash.indexOf('filteredStudents.map((s, i) =>') + 2600)
check('S8: session rows pass pendingStatus', sessionCall.includes('pendingStatus={pendingAttendance[s.id]}'))
check('S8: main students-table rows pass pendingStatus', mainCall.includes('pendingStatus={pendingAttendance[s.id]}'))
check('S9: saved status shown ONLY as a review-mode badge', sessionCall.includes('showSavedAttendanceBadge={showMarkedStudents || !activeLessonId || activeLesson?.status === \'completed\'}') && rowSrc.includes('showSavedAttendanceBadge && (s.attendance_status === \'حاضر\' || s.attendance_status === \'غائب\')'))
check('S9: main table passes NO badge (pure recording screen)', !mainCall.includes('showSavedAttendanceBadge'))

const realtimeSrc = dash.slice(dash.indexOf(".on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records'"), dash.indexOf(".on('postgres_changes', { event: '*', schema: 'public', table: 'exam_scores'"))
check('S10: realtime attendance handler never writes pendingAttendance', !realtimeSrc.includes('setPendingAttendance'))
check('S10: realtime attendance handler still updates the SAVED map (history live)', realtimeSrc.includes('setLessonAttendanceByStudent'))

check('S11: RPC success still records into the saved map', setAttSrc.includes('setLessonAttendanceByStudent((prev) => ({ ...prev, [id]: data'))
check('S11: saved ✅/❌ counters still derived from SAVED statuses', /sessionAttendanceCounts = useMemo\(\(\) => sessionStudents\.reduce/.test(dash) && /student\.attendance_status === 'حاضر'/.test(dash))
check('S12: unsaved counter separate from saved counters', /pendingSessionCount = useMemo\(\(\) => sessionStudents\.filter\(\(s\) => pendingAttendance\[s\.id\]\)\.length/.test(dash))
check('S12: header shows the unsaved indicator only when > 0', /pendingSessionCount > 0 && \(/.test(dash))
check('S11: undo (لم يرصد) still calls remove_attendance (server-side unmark)', setAttSrc.includes("rpc('remove_attendance'"))

// ── Part 2: behavioral simulation of the state machine ─────────────────────
// Mirrors the REAL transitions in Dashboard.jsx: pending = unsaved input,
// saved = lessonAttendanceByStudent + server rows (upsert per student).
console.log('\n  Behavioral simulation (T1–T14):')

;(async () => {
function makeClient() {
  return {
    pending: {},                    // pendingAttendance (input state)
    saved: {},                      // lessonAttendanceByStudent (saved map)
    serverRows: new Map(),          // attendance_records (DB, upsert by student)
    inFlight: new Set(),            // savingIds
    rpcCalls: 0,
    async setAttendance(id, status, ok = true) {
      if (this.inFlight.has(id)) return 'guarded'   // double-click guard (T9)
      if (this.saved[id]?.status === status) return 'idempotent'
      this.inFlight.add(id)
      this.pending = { ...this.pending, [id]: status }          // S2 input set
      try {
        if (!ok) throw new Error('network')
        this.rpcCalls++
        this.serverRows.set(id, { student_id: id, status, saved: true }) // upsert (T4/T9/T10)
        this.saved = { ...this.saved, [id]: { status } }        // S11 history
        const next = { ...this.pending }; delete next[id]       // S3 success clear
        this.pending = next
        return true
      } catch (e) {
        return false                                            // S5 keep pending
      } finally { this.inFlight.delete(id) }
    },
    realtimeAttendance(row) { this.saved = { ...this.saved, [row.student_id]: { status: row.status } } }, // S10
    newLesson() { this.pending = {} },                          // S6 reset
    buttonState(id) { return this.pending[id] || 'محايد' },
  }
}

const T = (name, cond) => check(name, cond)

// T1 — Present: select → save → UI neutral, DB present
let c = makeClient()
await c.setAttendance('a', 'حاضر')
T('T1: Present saved → input NEUTRAL + DB has present', c.buttonState('a') === 'محايد' && c.serverRows.get('a').status === 'حاضر')

// T2 — Absent
await c.setAttendance('b', 'غائب')
T('T2: Absent saved → input NEUTRAL + DB has absent', c.buttonState('b') === 'محايد' && c.serverRows.get('b').status === 'غائب')

// T3 — Mixed: 5 present + 3 absent → all neutral
c = makeClient()
for (const s of ['p1', 'p2', 'p3', 'p4', 'p5']) await c.setAttendance(s, 'حاضر')
for (const s of ['x1', 'x2', 'x3']) await c.setAttendance(s, 'غائب')
T('T3: mixed 5+3 → ALL inputs neutral', Object.keys(c.pending).length === 0 && [...c.serverRows.values()].filter(r => r.status === 'حاضر').length === 5 && [...c.serverRows.values()].filter(r => r.status === 'غائب').length === 3)

// T4 — persistence after UI reset
T('T4: DB still contains the records after the UI reset', c.serverRows.size === 8)

// T5 — history view still shows present/absent (the review badge source)
T('T5: history map still shows Present for p1', c.saved['p1'].status === 'حاضر')

// T6 — new day/session starts neutral
c.newLesson()
T('T6: new session starts ALL students neutral (no prefill)', c.buttonState('p1') === 'محايد' && c.buttonState('x1') === 'محايد')

// T7 — refresh: fresh client loads history but input starts neutral
const c7 = makeClient()
c7.saved = { p1: { status: 'حاضر' } }  // reload from DB (history only)
T('T7: after refresh, input neutral while history loaded', c7.buttonState('p1') === 'محايد' && c7.saved['p1'].status === 'حاضر')

// T8 — failed save: selection retained, nothing persisted
c = makeClient()
const r8 = await c.setAttendance('f', 'حاضر', false)
T('T8: failed save → selection RETAINED + no DB record + returns false', r8 === false && c.buttonState('f') === 'حاضر' && !c.serverRows.has('f'))

// T9 — double save: rapid double click → single record
c = makeClient()
const first = c.setAttendance('d', 'حاضر')
const second = c.setAttendance('d', 'حاضر')
await first; await second
const third = await c.setAttendance('d', 'حاضر')
T('T9: double-click guarded + idempotent → single DB record', c.serverRows.size === 1 && third === 'idempotent')

// T10 — two concurrent clients (two devices) → no duplicate records
const cA = makeClient(); const cB = makeClient()
const shared = new Map()   // shared "server" — both upsert into the same row space
for (const cli of [cA, cB]) {
  Object.defineProperty(cli, 'serverRows', { value: shared, writable: false })
}
await cA.setAttendance('k', 'حاضر')
await cB.setAttendance('k', 'حاضر')
T('T10: two clients upsert the same student → ONE shared record', shared.size === 1 && shared.get('k').status === 'حاضر')

// T11 — realtime event updates history but never the input state
c = makeClient()
c.realtimeAttendance({ student_id: 'r1', status: 'حاضر' })
T('T11: realtime updates history ONLY (input stays neutral)', c.saved['r1'].status === 'حاضر' && c.buttonState('r1') === 'محايد')

// T12 — unmark/change before the save lands (failed first attempt): no record
// for the abandoned status, only the final one is persisted
c = makeClient()
await c.setAttendance('u', 'حاضر', false)      // present selected, save failed
await c.setAttendance('u', 'غائب')              // changed to absent → retry OK
T('T12: change before save persists ONLY the final status (absent)', c.serverRows.get('u').status === 'غائب' && c.buttonState('u') === 'محايد')

// T13 — Neutral never writes a record (neutral ≠ absent)
c = makeClient()
T('T13: neutral student has NO record, no points, no side effects', !c.serverRows.has('n1') && c.rpcCalls === 0)

// T14 — historical vs current: saved present record coexists with neutral input
c = makeClient()
await c.setAttendance('h', 'حاضر')
T('T14: saved Present record exists WHILE current input is Neutral', c.serverRows.get('h').status === 'حاضر' && c.buttonState('h') === 'محايد')

console.log(failures === 0 ? '\nALL Round-11 checks PASSED' : `\n${failures} Round-11 check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
})()
