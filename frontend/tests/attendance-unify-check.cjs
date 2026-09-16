// Round 9 check — Single source of truth for attendance (السجل ↔ الحصص ↔ الماسح).
// Verifies the wiring at the source level:
//   1. finishLesson resets the LIVE mirror (students.attendance_status +
//      hw_status → لم يرصد) for the group, clears lessonAttendanceByStudent,
//      and leaves the lesson (activeLessonId '') — both views neutral.
//   2. Offline finish also resets locally + queues the reset ops.
//   3. setAttendance: the "open the lesson?" prompt when the student's group
//      has no open lesson today (askConfirm + openLessonForGroup with
//      forceNew when today's lesson is completed), online only; the legacy
//      day-record path survives ONLY for the offline/groupless fallback.
//   4. Idempotency guard uses the synced student status as fallback (no
//      double points on repeated marks for non-active lessons).
//   5. The live grid only auto-activates OPEN lessons (completed lessons are
//      history: سجل الحصص / التقارير / بوابة الطالب).
//   6. openLessonForGroup does NOT activate a completed lesson (neutral grid
//      + guidance toast instead of "data shown now").
//   7. QR scanner: smart routing (no hard error when no active lesson) and
//      the scan button enabled whenever students exist.
//   8. Search bar inside the lessons tab (sessions table) + empty state.
//   9. ExamModal: search bar in the grading phase + visible count + empty
//      state + Enter navigation follows the filtered list.
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Attendance unification (Round 9) checks:')

// ── 1. Dashboard.jsx ──
const dash = read('src/pages/Dashboard.jsx')

// finishLesson — online reset
const finishStart = dash.indexOf('const finishLesson = async () =>')
const finishEnd = dash.indexOf('finishLessonRef.current = finishLesson')
const finishBody = dash.slice(finishStart, finishEnd)
check('finishLesson exists', finishStart !== -1 && finishEnd > finishStart)
check('finishLesson resets students.attendance_status to لم يرصد (bulk .in update)', finishBody.includes(".update({ attendance_status: 'لم يرصد', hw_status: 'لم يرصد'") && finishBody.includes(".in('id', finishedStudentIds)"))
check('finishLesson updates local students state to neutral', /setStudents\(\(prev\) => prev\.map\(\(st\) => \(finishedStudentIds\.includes\(st\.id\)[\s\S]{0,120}attendance_status: 'لم يرصد'/.test(finishBody))
check('finishLesson clears the lesson grid (lessonAttendanceByStudent → {})', /setLessonAttendanceByStudent\(\{\}\)/.test(finishBody))
check('finishLesson leaves the lesson (setActiveLessonId(\'\'))', /setActiveLessonId\(''\)/.test(finishBody))
check('finishLesson pings open portals after the reset', /pingPortalRefresh\(\)/.test(finishBody))
check('finishLesson no longer pins the final map into the live grid', !finishBody.includes('setLessonAttendanceByStudent(finalMap)'))
check('finishLesson reset failure is non-fatal (history already saved)', /Live-mirror reset after finalize failed/.test(finishBody))

// finishLesson — offline reset
check('offline finish queues the neutral reset ops', /for \(const sid of offlineGroupStudentIds\)[\s\S]{0,160}addToQueue\(\{ table: 'students', method: 'update'[\s\S]{0,120}attendance_status: 'لم يرصد'/.test(finishBody))
check('offline finish resets local state + leaves the lesson', /offlineGroupStudentIds[\s\S]{0,600}setLessonAttendanceByStudent\(\{\}\)[\s\S]{0,80}setActiveLessonId\(''\)/.test(finishBody))

// setAttendance — prompt + routing
const setAttStart = dash.indexOf('const setAttendance = async (id, status, lessonIdOverride)')
const setAttEnd = dash.indexOf('const updateHW = async')
const setAtt = dash.slice(setAttStart, setAttEnd)
check('setAttendance exists', setAttStart !== -1)
check('prompt: asks to open the lesson when no open lesson today (askConfirm)', setAtt.includes('فتح الحصة؟') && setAtt.includes('askConfirm'))
check('prompt: only when the student has a group and is online', /if \(!lessonId && s\.group_name && isOnline\)/.test(setAtt))
check('prompt: forceNew only when today lesson is completed', setAtt.includes('forceNew: hasCompletedToday'))
check('prompt: mark routed into the newly opened lesson', /lessonId = openedLesson\.id/.test(setAtt))
check('prompt: cancel + failed-open paths leave nothing recorded', setAtt.includes('تسجيل الحضور اتلغى') && setAtt.includes('if (!ok) return'))
check('guard: previous status falls back to the synced student status (no double points)', /lessonAttendanceByStudent\[id\]\?\.status \|\| s\.attendance_status \|\| 'لم يرصد'/.test(setAtt))
check('guard: skip when previous status equals the target', /if \(previousAttendanceStatus === status\) return/.test(setAtt))
check('lesson path still syncs students.attendance_status (السجل mirror)', /studentPatch = \{ attendance_status: status, points: newPoints \}/.test(setAtt))
check('day-record path remains ONLY as the groupless-student fallback (prompt handles grouped students)', (() => {
  // The prompt must come BEFORE the save branches and must resolve lessonId
  // (or return) for every grouped student while online — so the online
  // day-record branch is reachable only for students without a group.
  // (The offline queue day-record op is legitimate: no lesson can be opened
  // while offline, so grouped students keep the legacy fallback there.)
  const promptIdx = setAtt.indexOf('if (!lessonId && s.group_name && isOnline)')
  const guardIdx = setAtt.indexOf('if (previousAttendanceStatus === status) return')
  const onlineSelectIdx = setAtt.indexOf("from('attendance_records').select('id')")
  return promptIdx !== -1 && guardIdx > promptIdx && onlineSelectIdx > guardIdx
})())

// live grid — open lessons only
const effStart = dash.indexOf('useEffect(() => {\n    if (!sessionGroup)')
const effEnd = dash.indexOf('useEffect(() => {\n    let cancelled = false')
const autoEffect = dash.slice(effStart, effEnd)
check('auto-select effect prefers ONLY open lessons of today', /preferred = candidates\.find\(\(lesson\) => lesson\.status === 'open' && lesson\.session_date === today\)\s*\n\s*setActiveLessonId\(preferred\?\.id \|\| ''\)/.test(autoEffect) && !autoEffect.includes("candidates.find((lesson) => lesson.session_date === today)"))

// openLessonForGroup — completed lesson not activated
const openStart = dash.indexOf('const openLessonForGroup = async (groupName')
const openEnd = dash.indexOf('const chooseSessionGroup =')
const openBody = dash.slice(openStart, openEnd)
check('openLessonForGroup does NOT activate completed lessons (neutral grid)', !/setActiveLessonId\(existingToday\.id\)/.test(openBody))
check('openLessonForGroup completed-branch clears the grid + draft', /setActiveLessonId\(''\); setLessonAttendanceByStudent\(\{\}\)/.test(openBody))
check('openLessonForGroup completed-branch points to سجل الحصص + نيوترال toast', openBody.includes('سجل الحصص') && openBody.includes('نيوترال'))

// QR scanner wiring
check('QR onMarkPresent uses smart routing (no hard error without active lesson)', !dash.includes("افتح الحصة أولاً قبل مسح QR") && /onMarkPresent=\{\(id\) => \{ setAttendance\(id, 'حاضر', undefined\) \}\}/.test(dash))
check('QR scan button enabled whenever students exist', /disabled=\{students\.length === 0\}\>\{t\('scan_qr'\)\}/.test(dash))

// search bar in lessons tab
check('sessions tab: search state exists', dash.includes('sessionStudentSearch, setSessionStudentSearch'))
check('sessions tab: search input rendered with placeholder', /data-tour="session-student-search"/.test(dash) && dash.includes('ابحث عن طالب في المجموعة'))
check('sessions tab: table maps the filtered list', /visibleSessionStudents\.map\(\(s, i\)/.test(dash))
check('sessions tab: empty-search state row', dash.includes('لا يوجد طالب بالاسم ده في المجموعة'))
check('sessions tab: counts still computed on the full group list', /sessionAttendanceCounts = useMemo\(\(\) => sessionStudents\.reduce/.test(dash))
check('sessions grid mirrors the register when no lesson is open (fallback mapping)', /attendance_status: activeLessonId \? \(lessonAttendanceByStudent\[s\.id\]\?\.status \|\| 'لم يرصد'\) : \(s\.attendance_status \|\| 'لم يرصد'\)/.test(dash) && /hw_status: activeLessonId \? \(lessonAttendanceByStudent\[s\.id\]\?\.homework_status \|\| 'لم يرصد'\) : \(s\.hw_status \|\| 'لم يرصد'\)/.test(dash))

// ── 2. ExamModal.jsx ──
const exam = read('src/components/ExamModal.jsx')
check('ExamModal: grading search state', exam.includes('gradingSearch, setGradingSearch'))
check('ExamModal: search input with placeholder', exam.includes('ابحث عن طالب في القايمة'))
check('ExamModal: visibleStudents filters presentStudents', /visibleStudents = useMemo\(\(\) => \{[\s\S]{0,300}presentStudents\.filter/.test(exam))
check('ExamModal: grading table maps visibleStudents', /visibleStudents\.map\(\(s, rowIdx\)/.test(exam))
check('ExamModal: visible-count label (X من Y طالب)', exam.includes('طالب') && exam.includes('${visibleStudents.length}'))
check('ExamModal: Enter navigation follows the filtered list', /row \+ 1 < visibleStudents\.length/.test(exam))
check('ExamModal: empty-search state row', exam.includes('لا يوجد طالب بالاسم ده في قايمة الرصد'))
check('ExamModal: search cleared when the modal reopens', /setNewTplName\(''\); setGradingSearch\(''\)/.test(exam))

// ── 3. No regressions in the portal (history untouched) ──
const portal = read('src/pages/PublicQRPage.jsx')
check('portal still renders lesson history (no live-mirror dependency)', portal.includes('lesson_attendance') || portal.includes('lessonTimeline'))

console.log('')
if (failures === 0) {
  console.log('ALL attendance-unify checks PASSED')
  process.exit(0)
} else {
  console.log(`${failures} check(s) FAILED`)
  process.exit(1)
}
