// ═══════════════════════════════════════════════════════════════════════════
// NOKHBA DEMO BACKEND — sandbox preview adapter.
//
// Activated ONLY when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent
// (i.e. this preview sandbox, where production credentials cannot exist).
// With real env vars present, the app uses the REAL supabase-js client and
// this file is never imported.
//
// It faithfully mirrors the REAL backend semantics audited from
// supabase/migrations (002→041):
//   • attendance_records UNIQUE (lesson_session_id, student_id)
//   • status strings 'حاضر' | 'غائب' | 'لم يرصد' (+ homework 'مكتمل'|'ناقص'|'لم يتم'|'لم يرصد')
//   • lesson_sessions status 'open' | 'completed'
//   • RPCs: upsert_lesson_attendance / upsert_lesson_homework /
//     finalize_lesson_session / resolve_student_by_qr /
//     get_or_create_student_qr_token / update_exam_max_score /
//     update_student_exam_score / send_announcement ...
//   • realtime postgres_changes events for the same tables the production
//     channel subscribes to (so realtime code paths are exercised in preview).
// ═══════════════════════════════════════════════════════════════════════════

// DB_KEY v4 (Task 44): fixtures واجب الاختيارات — homework_quizzes +
// أسئلته + تسليم مريم المحفوظ (زيادة كده بت_RESET حالة الديمو مرة واحدة).
const DB_KEY = 'alnokhba_demo_db_v4'
const SESSION_KEY = 'alnokhba_demo_session_v1'

export const DEMO_TEACHER_ID = 'a0000000-0000-4000-8000-00000000c0de'

const uid = () =>
  'd' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) +
  Date.now().toString(36)

const iso = (offsetMinutes = 0) => new Date(Date.now() + offsetMinutes * 60000).toISOString()
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayStr = (offsetDays = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function seed() {
  const t = DEMO_TEACHER_ID
  const groups = ['مجموعة أ — تاريخ', 'مجموعة ب — تاريخ']
  const mkStudent = (name, group, code, stage, points) => ({
    id: uid(), teacher_id: t, code, name, phone: '010' + String(10000000 + Math.floor(Math.random() * 89999999)),
    stage, group_name: group, points, warnings: 0, attendance_status: 'لم يرصد', hw_status: 'لم يرصد',
    created_at: iso(-60 * 24 * 30), updated_at: iso(-60),
  })
  const students = [
    mkStudent('أحمد مصطفى', groups[0], 'F-10231', 'الثاني الثانوي', 42),
    mkStudent('مريم سعيد', groups[0], 'F-10232', 'الثاني الثانوي', 38),
    mkStudent('يوسف عبدالله', groups[0], 'F-10233', 'الثاني الثانوي', 27),
    mkStudent('سلمى حسن', groups[0], 'F-10234', 'الثاني الثانوي', 51),
    mkStudent('عمر خالد', groups[0], 'F-10235', 'الثاني الثانوي', 12),
    mkStudent('حبيبة إبراهيم', groups[0], 'F-10236', 'الثاني الثانوي', 33),
    mkStudent('زياد طارق', groups[1], 'F-10241', 'الثالث الثانوي', 44),
    mkStudent('نور الدين ماهر', groups[1], 'F-10242', 'الثالث الثانوي', 30),
    mkStudent('فريدة سامي', groups[1], 'F-10243', 'الثالث الثانوي', 25),
    mkStudent('مازن عادل', groups[1], 'F-10244', 'الثالث الثانوي', 18),
  ]
  const weekday = new Date().getDay()
  const group_schedule = [
    { id: uid(), teacher_id: t, group_name: groups[0], weekday, lesson_time: '16:30' },
    { id: uid(), teacher_id: t, group_name: groups[1], weekday, lesson_time: '18:00' },
    { id: uid(), teacher_id: t, group_name: groups[0], weekday: (weekday + 3) % 7, lesson_time: '16:30' },
    { id: uid(), teacher_id: t, group_name: groups[1], weekday: (weekday + 2) % 7, lesson_time: '18:00' },
  ]
  const lessonToday = {
    id: uid(), teacher_id: t, group_name: groups[0], stage: 'الثاني الثانوي',
    session_date: todayStr(), status: 'open', lesson_topic: 'الثورة العرابية — الأسباب', homework_text: 'حل أسئلة الصفحة ٤٥',
    video_link: '', started_at: iso(-95), ended_at: null, created_at: iso(-95), updated_at: iso(-30),
  }
  const lessonYesterday = {
    id: uid(), teacher_id: t, group_name: groups[1], stage: 'الثالث الثانوي',
    session_date: dayStr(-1), status: 'completed', lesson_topic: 'مراجعة الامتحان السابق', homework_text: '',
    video_link: '', started_at: iso(-60 * 27 * 60), ended_at: iso(-60 * 25 * 60), created_at: iso(-60 * 27 * 60), updated_at: iso(-60 * 25 * 60),
  }
  // Task 41 demo fixtures: أسبوع ماضي بدون امتحان + حصة النهارده لمجموعة ب
  // بامتحان أحدث من امتحان الأمبارح — لإثبات أن {examLine} بياخد درجة امتحان
  // الحصة دي بالذات (مش الأحدث)، وبيختفي لما مفيش امتحان في الحصة.
  const lessonLastWeek = {
    id: uid(), teacher_id: t, group_name: groups[1], stage: 'الثالث الثانوي',
    session_date: dayStr(-8), status: 'completed', lesson_topic: 'مدخل الوحدة الأولى', homework_text: '',
    video_link: '', started_at: iso(-60 * 24 * 8), ended_at: iso(-60 * 23 * 60), created_at: iso(-60 * 24 * 8), updated_at: iso(-60 * 23 * 60),
  }
  const lessonToday2 = {
    id: uid(), teacher_id: t, group_name: groups[1], stage: 'الثالث الثانوي',
    session_date: todayStr(), status: 'completed', lesson_topic: 'شرح درس جديد', homework_text: 'حل أسئلة الكتاب',
    video_link: '', started_at: iso(-200), ended_at: iso(-30), created_at: iso(-200), updated_at: iso(-30),
  }
  // Task 42 fixtures: آخر حصتين لمجموعة أ (كلهم مكتملين وتاريخهم فات) —
  // يوسف عبدالله غايب في الاتنين → لازم يتأرشف تلقائيًا عند أول تحميل،
  // وأحمد مصطفى حاضر فيهم، وسلمى حسن غايب في واحدة بس — الاتنين لازم يفضلوا
  // نشطين (تمييز دقيق: غياب واحد لا يكفي، والغياب لازم يكون صريحًا في الحصتين).
  const lessonA1 = {
    id: uid(), teacher_id: t, group_name: groups[0], stage: 'الثاني الثانوي',
    session_date: dayStr(-2), status: 'completed', lesson_topic: 'حل امتحان التجربة', homework_text: '',
    video_link: '', started_at: iso(-60 * 24 * 2 * 60), ended_at: iso(-60 * 24 * 2 * 60 + 90), created_at: iso(-60 * 24 * 2 * 60), updated_at: iso(-60 * 24 * 2 * 60 + 90),
  }
  const lessonA2 = {
    id: uid(), teacher_id: t, group_name: groups[0], stage: 'الثاني الثانوي',
    session_date: dayStr(-5), status: 'completed', lesson_topic: 'الوحدة الثانية — التمهيد', homework_text: '',
    video_link: '', started_at: iso(-60 * 24 * 5 * 60), ended_at: iso(-60 * 24 * 5 * 60 + 90), created_at: iso(-60 * 24 * 5 * 60), updated_at: iso(-60 * 24 * 5 * 60 + 90),
  }
  const attendance_records = [
    { id: uid(), teacher_id: t, student_id: students[0].id, status: 'حاضر', homework_status: 'مكتمل', lesson_session_id: lessonToday.id, recorded_at: iso(-80), attendance_date: todayStr() },
    { id: uid(), teacher_id: t, student_id: students[1].id, status: 'حاضر', homework_status: 'لم يرصد', lesson_session_id: lessonToday.id, recorded_at: iso(-79), attendance_date: todayStr() },
    { id: uid(), teacher_id: t, student_id: students[2].id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lessonToday.id, recorded_at: iso(-78), attendance_date: todayStr() },
    { id: uid(), teacher_id: t, student_id: students[6].id, status: 'حاضر', homework_status: 'مكتمل', lesson_session_id: lessonYesterday.id, recorded_at: iso(-60 * 26 * 60), attendance_date: dayStr(-1) },
    { id: uid(), teacher_id: t, student_id: students[7].id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lessonYesterday.id, recorded_at: iso(-60 * 26 * 60), attendance_date: dayStr(-1) },
    { id: uid(), teacher_id: t, student_id: students[6].id, status: 'حاضر', homework_status: 'مكتمل', lesson_session_id: lessonLastWeek.id, recorded_at: iso(-60 * 24 * 8 + 60), attendance_date: dayStr(-8) },
    { id: uid(), teacher_id: t, student_id: students[7].id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lessonLastWeek.id, recorded_at: iso(-60 * 24 * 8 + 61), attendance_date: dayStr(-8) },
    { id: uid(), teacher_id: t, student_id: students[6].id, status: 'حاضر', homework_status: 'مكتمل', lesson_session_id: lessonToday2.id, recorded_at: iso(-199), attendance_date: todayStr() },
    { id: uid(), teacher_id: t, student_id: students[7].id, status: 'حاضر', homework_status: 'لم يرصد', lesson_session_id: lessonToday2.id, recorded_at: iso(-198), attendance_date: todayStr() },
    // Task 42: يوسف غايب في آخر حصتين لمجموعة أ → أرشفة تلقائية عند التحميل
    { id: uid(), teacher_id: t, student_id: students[2].id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lessonA1.id, recorded_at: iso(-60 * 24 * 2 * 60 + 30), attendance_date: dayStr(-2) },
    { id: uid(), teacher_id: t, student_id: students[0].id, status: 'حاضر', homework_status: 'مكتمل', lesson_session_id: lessonA1.id, recorded_at: iso(-60 * 24 * 2 * 60 + 31), attendance_date: dayStr(-2) },
    { id: uid(), teacher_id: t, student_id: students[3].id, status: 'حاضر', homework_status: 'لم يرصد', lesson_session_id: lessonA1.id, recorded_at: iso(-60 * 24 * 2 * 60 + 32), attendance_date: dayStr(-2) },
    { id: uid(), teacher_id: t, student_id: students[2].id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lessonA2.id, recorded_at: iso(-60 * 24 * 5 * 60 + 30), attendance_date: dayStr(-5) },
    { id: uid(), teacher_id: t, student_id: students[0].id, status: 'حاضر', homework_status: 'مكتمل', lesson_session_id: lessonA2.id, recorded_at: iso(-60 * 24 * 5 * 60 + 31), attendance_date: dayStr(-5) },
    { id: uid(), teacher_id: t, student_id: students[3].id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lessonA2.id, recorded_at: iso(-60 * 24 * 5 * 60 + 32), attendance_date: dayStr(-5) },
  ]
  const exam = { id: uid(), teacher_id: t, title: 'امتحان شهر أكتوبر', sections: ['السؤال الأول', 'السؤال الثاني'], max_score_per_section: 20, lesson_session_id: lessonYesterday.id, version: 1, created_at: iso(-60 * 25 * 60), updated_at: iso(-60 * 25 * 60) }
  const exam2 = { id: uid(), teacher_id: t, title: 'اختبار اليوم القصير', sections: ['أسئلة سريعة'], max_score_per_section: 10, lesson_session_id: lessonToday2.id, version: 1, created_at: iso(-30), updated_at: iso(-30) }
  const exams = [exam, exam2]
  const exam_scores = students.slice(6).map((s, i) => ({
    id: uid(), teacher_id: t, exam_id: exam.id, student_id: s.id, lesson_session_id: lessonYesterday.id,
    section_scores: { 'السؤال الأول': 15 - i, 'السؤال الثاني': 17 - i }, total_score: 32 - i * 2, version: 1, created_at: iso(-60 * 24 * 60), updated_at: iso(-60 * 24 * 60),
  }))
  // زياد امتحن اختبار النهارده (أحدث created_at في كل الداتا) — التقرير
  // بتاع الأمبارح لازم يفضل يورّي «امتحان شهر أكتوبر» مش الاختبار الأحدث ده.
  exam_scores.push({ id: uid(), teacher_id: t, exam_id: exam2.id, student_id: students[6].id, lesson_session_id: lessonToday2.id, section_scores: { 'أسئلة سريعة': 9 }, total_score: 9, version: 1, created_at: iso(-29), updated_at: iso(-29) })
  // الامتحان المنفصل (migration 051) — مستقل عن الحصص: امتحن = حضر
  const saExam = {
    id: uid(), teacher_id: t, title: 'امتحان منفصل — الوحدة الأولى', exam_date: dayStr(-2),
    group_name: groups[0], max_score: 100,
    grade_scale: [{ name: 'ممتاز', min: 80 }, { name: 'جيد', min: 70 }, { name: 'مقبول', min: 60 }, { name: 'ضعيف', min: 0 }],
    status: 'open', created_at: iso(-60 * 24 * 48), updated_at: iso(-60 * 24 * 48),
  }
  const saScores = students.slice(0, 4).map((s, i) => ({
    id: uid(), teacher_id: t, exam_id: saExam.id, student_id: s.id,
    score: [88, 74, 62, 45][i], created_at: iso(-60 * 24 * 47), updated_at: iso(-60 * 24 * 47),
  }))
  const standalone_exams = [saExam]
  const standalone_exam_scores = saScores

  // ── Task 44 fixtures — واجب الاختيارات الإلكتروني ──
  // أرقام ثابتة للتجربة: أحمد 01000000001 · مريم 01000000002 (والأكواد F-102xx)
  students[0].phone = '01000000001'
  students[1].phone = '01000000002'
  // واجب منشور على حصة lessonA1 (مجموعة أ — قبل يومين): الحصة اللي وراها
  // هي حصة النهارده → المزامنة التلقائية هتسجّل تسليم مريم في تاب الواجب فورًا.
  const hwQuiz = {
    id: uid(), teacher_id: t, lesson_session_id: lessonA1.id,
    title: 'واجب الوحدة الثانية', instructions: 'حِل أسئلة الكتاب صفحة ٤٠ ثم اختار الإجابات هنا',
    access_token: 'demo0000000000000000000000000044', is_published: true,
    video_url: 'https://www.youtube.com/watch?v=2HdKBtVLUYk',
    created_at: iso(-60 * 24 * 2 * 60 + 100), updated_at: iso(-60 * 24 * 2 * 60 + 100),
  }
  const hwQ = (position, question_text, kind, options, correct_options, explanation) => ({
    id: uid(), quiz_id: hwQuiz.id, teacher_id: t, position, question_text, kind, options,
    correct_options, explanation: explanation || null,
    created_at: iso(-60 * 24 * 2 * 60 + 101), updated_at: iso(-60 * 24 * 2 * 60 + 101),
  })
  const hwQuestions = [
    hwQ(0, 'عاصمة مصر؟', 'mcq',
      [{ id: 'a', label: 'القاهرة' }, { id: 'b', label: 'أسوان' }, { id: 'c', label: 'طنطا' }, { id: 'd', label: 'الإسكندرية' }],
      ['a'], 'القاهرة هي العاصمة'),
    hwQ(1, 'الشمس تشرق من الشرق', 'true_false',
      [{ id: 't', label: 'صح' }, { id: 'f', label: 'غلط' }],
      ['t'], null),
    // سؤال من الكتاب — بدون نص (نص السؤال اختياري بالطلب)
    hwQ(2, null, 'mcq',
      [{ id: 'a', label: '' }, { id: 'b', label: '' }, { id: 'c', label: '' }, { id: 'd', label: '' }],
      ['c'], null),
  ]
  // مريم سلّمت: غلط في الأول (اختارت ب) وصح في الباقي → 2/3 (67%)
  const hwSubmissions = [{
    id: uid(), quiz_id: hwQuiz.id, teacher_id: t, student_id: students[1].id,
    device_fingerprint: 'demo-device-mariam-01',
    answers: { [hwQuestions[0].id]: ['b'], [hwQuestions[1].id]: ['t'], [hwQuestions[2].id]: ['c'] },
    score: 2, max_score: 3, correct_count: 2, question_count: 3,
    submitted_at: iso(-60 * 24 * 2 * 60 + 110),
  }]
  const behavior_logs = [
    { id: uid(), teacher_id: t, student_id: students[0].id, note: 'تسجيل الحضور: حاضر (+1 نقطة)', points_delta: 1, created_at: iso(-80) },
    { id: uid(), teacher_id: t, student_id: students[0].id, note: 'إجابة وتفاعل (+3 نقطة)', points_delta: 3, created_at: iso(-50) },
  ]

  // ── EL NO5BA CENTERS demo data (separate product, same account) ──
  const centerId = 'c0000000-0000-4000-8000-00000000c0de'
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const cRoom = (name, capacity) => ({ id: uid(), center_id: centerId, name, capacity, notes: null, created_at: iso(-60 * 24 * 40) })
  const cRooms = [cRoom('قاعة 1', 20), cRoom('قاعة 2', 14)]
  const cTeachers = [
    { id: uid(), center_id: centerId, name: 'أحمد علي', phone: '01011111111', subject: 'رياضيات', notes: null, created_at: iso(-60 * 24 * 40) },
    { id: uid(), center_id: centerId, name: 'سارة محمود', phone: '01022222222', subject: 'لغة عربية', notes: null, created_at: iso(-60 * 24 * 39) },
    { id: uid(), center_id: centerId, name: 'كريم فؤاد', phone: '01033333333', subject: 'فيزياء', notes: null, created_at: iso(-60 * 24 * 38) },
  ]
  const cStudent = (name, stage, phone) => ({ id: uid(), center_id: centerId, name, phone, parent_phone: '01' + String(200000000 + Math.floor(Math.random() * 899999999)), stage, notes: null, created_at: iso(-60 * 24 * 30) })
  const cStudents = [
    cStudent('مالك أحمد', 'الثالث الثانوي', '01055550001'), cStudent('هنا وليد', 'الثالث الثانوي', '01055550002'),
    cStudent('زياد أشرف', 'الثالث الثانوي', '01055550003'), cStudent('ندى بدر', 'الثالث الثانوي', '01055550004'),
    cStudent('عبدالرحمن طارق', 'الثاني الثانوي', '01055550005'), cStudent('مريم عادل', 'الثاني الثانوي', '01055550006'),
    cStudent('كريم سمير', 'الثاني الثانوي', '01055550007'), cStudent('دينا حسام', 'الثاني الثانوي', '01055550008'),
    cStudent('طارق منير', 'الأول الثانوي', '01055550009'), cStudent('لينا صبري', 'الأول الثانوي', '01055550010'),
    cStudent('فادي رأفت', 'الأول الثانوي', '01055550011'), cStudent('سلمى ياسر', 'الأول الثانوي', '01055550012'),
  ]
  const cGroup = (name, subject, grade, teacherIdx, roomIdx, weekday, start, end) => ({
    id: uid(), center_id: centerId, name, subject, grade,
    teacher_id: cTeachers[teacherIdx].id, room_id: cRooms[roomIdx].id, capacity: cRooms[roomIdx].capacity,
    color: null, schedule: [{ weekday, start, end }], created_at: iso(-60 * 24 * 35),
  })
  const cGroups = [
    cGroup('رياضيات — تالتة ثانوي', 'رياضيات', 'الثالث الثانوي', 0, 0, now.getDay(), '17:00', '19:00'),
    cGroup('عربي — تالتة ثانوي', 'لغة عربية', 'الثالث الثانوي', 1, 1, now.getDay(), '13:00', '14:30'),
    cGroup('فيزياء — تانية ثانوي', 'فيزياء', 'الثاني الثانوي', 2, 0, (now.getDay() + 2) % 7, '15:00', '16:30'),
    cGroup('رياضيات — أولى ثانوي', 'رياضيات', 'الأول الثانوي', 0, 1, (now.getDay() + 1) % 7, '10:00', '11:30'),
  ]
  const cEnroll = (gIdx, sIdx) => ({ id: uid(), center_id: centerId, group_id: cGroups[gIdx].id, student_id: cStudents[sIdx].id, created_at: iso(-60 * 24 * 20) })
  const cEnrollments = [
    cEnroll(0, 0), cEnroll(0, 1), cEnroll(0, 2), cEnroll(0, 3),
    cEnroll(1, 0), cEnroll(1, 1), cEnroll(1, 3),
    cEnroll(2, 4), cEnroll(2, 5), cEnroll(2, 6), cEnroll(2, 7),
    cEnroll(3, 8), cEnroll(3, 9), cEnroll(3, 10), cEnroll(3, 11),
  ]
  // today: group1 completed (morning), group2 LIVE right now, and one more
  // upcoming this evening; yesterday: physics completed (report material).
  const cSession = (gIdx, date, start, end, status, topic) => ({
    id: uid(), center_id: centerId, group_id: cGroups[gIdx].id, room_id: cGroups[gIdx].room_id,
    teacher_id: cGroups[gIdx].teacher_id, session_date: date, starts_at: start, ends_at: end,
    status, topic: topic || null, notes: null, completed_at: status === 'completed' ? iso(-60) : null,
    created_at: iso(-60 * 30), updated_at: iso(-30),
  })
  const liveStart = new Date(now.getTime() - 30 * 60000)
  const liveEnd = new Date(now.getTime() + 60 * 60000)
  const cSessions = [
    cSession(1, todayStr(), '13:00', '14:30', 'completed', 'البلاغة — التشبيه'),
    cSession(0, todayStr(), hhmm(liveStart), hhmm(liveEnd), 'live', 'التكامل بالتعويض'),
    cSession(0, dayStr(-2), '17:00', '19:00', 'completed', 'الهندسة الفراغية'),
    cSession(2, dayStr(-1), '15:00', '16:30', 'completed', 'الكهربية الساكنة'),
    cSession(3, dayStr(1), '10:00', '11:30', 'upcoming', null),
  ]
  const cAtt = (sIdx, stIdx, status) => ({ id: uid(), center_id: centerId, session_id: cSessions[sIdx].id, student_id: cStudents[stIdx].id, status, note: null, updated_at: iso(-20) })
  const cAttendance = [
    cAtt(0, 0, 'present'), cAtt(0, 1, 'late'), cAtt(0, 2, 'absent'), cAtt(0, 3, 'present'),
    cAtt(2, 0, 'present'), cAtt(2, 1, 'present'), cAtt(2, 2, 'excused'), cAtt(2, 3, 'absent'),
    cAtt(3, 4, 'present'), cAtt(3, 5, 'present'), cAtt(3, 6, 'late'), cAtt(3, 7, 'present'),
  ]
  const settings = {
    teacher_id: t,
    groups,
    group_meta: { [groups[0]]: { stage: 'الثاني الثانوي', day: weekday, time: '16:30' }, [groups[1]]: { stage: 'الثالث الثانوي', day: weekday, time: '18:00' } },
    points_present: 1, points_absent: -1, points_interact: 3, points_interrupt: -3,
    ranks: [
      { min: 0, title: 'مبتدئ' }, { min: 10, title: 'مجتهد' }, { min: 20, title: 'متفوق' }, { min: 30, title: 'متميز' },
      { min: 40, title: 'نجم الصف' }, { min: 50, title: 'أسطورة' }, { min: 60, title: 'المتنبي' },
    ],
    msg_welcome: 'مرحبًا {studentName} 🌟 نتمنى لك دوام التوفيق',
    msg_warning: 'عزيزي ولي أمر {studentName}، نود إبلاغكم بصدور إنذار للطالب.',
    msg_promotion: 'مبروك! تمت ترقية {studentName} إلى رتبة {rank} 🎉',
    msg_report_template: '', report_fields: ['rank', 'position', 'points', 'warnings', 'attendance', 'homework', 'session', 'logs'],
    insight_config: { attendance_warning_threshold: 75, performance_warning_threshold: 60, repeated_absence_count: 3 },
    notification_preferences: { attendance: true, homework: true, exams: true, lessons: true, payments: true, announcements: true },
    whatsapp_number: '201000000000', qr_message_template: 'مرحباً {studentName}\nرابط متابعة الطالب:',
    absence_warning_threshold: 2, absence_attention_threshold: 3,
  }
  const branding = {
    teacher_id: t, display_name: 'مدرس النخبة', center_name: 'أكاديمية النخبة التعليمية', logo_url: '',
    palette_key: 'nokhba-navy-gold', language: 'ar',
  }
  const broadcasts = [
    { id: uid(), admin_id: 'admin', message: 'تحديث جديد: مسار الحصص أصبح متاحًا للجميع — جرّب مساحة الحصة الجديدة.', created_at: iso(-300) },
  ]
  return {
    profiles: [], students, group_schedule, lesson_sessions: [lessonToday, lessonToday2, lessonYesterday, lessonLastWeek, lessonA1, lessonA2],
    attendance_records, exams, exam_scores, behavior_logs, teacher_settings: [settings],
    standalone_exams, standalone_exam_scores,
    homework_quizzes: [hwQuiz], homework_quiz_questions: hwQuestions, homework_quiz_submissions: hwSubmissions,
    workspace_branding: [branding], broadcast_messages: broadcasts,
    // توكن بوابة ثابت للديمو (20 حرف) — /qr/demoqrtoken000000000 → أحمد
    student_qr_tokens: [{ id: uid(), teacher_id: t, student_id: students[0].id, token: 'demoqrtoken000000000', revoked_at: null, created_at: iso(-60 * 24 * 30) }],
    student_notifications: [], teacher_notification_events: [],
    session_logs: [], homework_tasks: [], homework_task_status: [], announcements: [],
    // EL NO5BA CENTERS
    centers: [{
      id: centerId, owner_id: t, name: 'مركز النخبة التعليمي', phone: '0223334444',
      address: 'مدينة نصر — القاهرة', notes: null, created_at: iso(-60 * 24 * 45),
    }],
    center_members: [{ id: uid(), center_id: centerId, user_id: t, role: 'owner', created_at: iso(-60 * 24 * 45) }],
    center_rooms: cRooms,
    center_teachers: cTeachers,
    center_students: cStudents,
    center_groups: cGroups,
    center_group_students: cEnrollments,
    center_sessions: cSessions,
    center_attendance: cAttendance,
    center_audit_logs: [{ id: 1, center_id: centerId, actor_id: t, action: 'create_center', target_type: 'centers', target_id: centerId, details: 'إنشاء مركز: مركز النخبة التعليمي', metadata: {}, created_at: iso(-60 * 24 * 45) }],
  }
}

function loadDb() {
  let raw = null
  try { raw = localStorage.getItem(DB_KEY) } catch { /* storage blocked */ }
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        // Shape-safe merge (preview-panel crash fix): a DB written by an
        // OLDER build of the demo client may be missing tables that were
        // added later — queries on them returned undefined.filter and
        // crashed the authed dashboard right after the landing blink.
        // Fresh seed guarantees every table exists; the stored rows win.
        const fresh = seed()
        const merged = { ...fresh, ...parsed }
        for (const key of Object.keys(fresh)) {
          if (Array.isArray(fresh[key]) && !Array.isArray(merged[key])) merged[key] = fresh[key]
        }
        saveDb(merged) // persist healed shape — storage self-upgrades once, not every load
        return merged
      }
    } catch { /* corrupted → reseed */ }
  }
  const fresh = seed()
  saveDb(fresh)
  return fresh
}
function saveDb(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)) } catch { /* quota — keep in memory */ }
}

// ── realtime plumbing ────────────────────────────────────────────────────────
const listeners = new Set()
function emitEvent(table, eventType, row, oldRow) {
  const payload = eventType === 'DELETE' ? { eventType, old: oldRow } : { eventType, new: row, old: oldRow || {} }
  setTimeout(() => {
    listeners.forEach((l) => { try { l(table, payload) } catch { /* isolate */ } })
  }, 0)
}

// ── query builder ────────────────────────────────────────────────────────────
class Query {
  constructor(db, table) {
    this._db = db; this._table = table; this._rows = db[table] || []
    this._filters = []; this._order = null; this._limitVal = null
    this._single = false; this._maybe = false; this._selectCols = '*'
    this._count = null
    this._mut = null // {type:'insert'|'update'|'upsert'|'delete', data, opts}
  }
  select(cols = '*', opts) {
    if (opts && opts.count) this._count = opts.count
    this._selectCols = cols
    return this
  }
  eq(col, val) { this._filters.push(['eq', col, val]); return this }
  neq(col, val) { this._filters.push(['neq', col, val]); return this }
  is(col, val) { this._filters.push(['eq', col, val]); return this } // only used with null
  gt(col, val) { this._filters.push(['gt', col, val]); return this }
  gte(col, val) { this._filters.push(['gte', col, val]); return this }
  lt(col, val) { this._filters.push(['lt', col, val]); return this }
  lte(col, val) { this._filters.push(['lte', col, val]); return this }
  in(col, vals) { this._filters.push(['in', col, vals]); return this }
  order(col, opts = {}) { this._order = { col, asc: opts.ascending !== false }; return this }
  limit(n) { this._limitVal = n; return this }
  single() { this._single = true; return this }
  maybeSingle() { this._single = true; this._maybe = true; return this }
  insert(data, opts) { this._mut = { type: 'insert', data: Array.isArray(data) ? data : [data], opts: opts || {} }; return this }
  upsert(data, opts) { this._mut = { type: 'upsert', data: Array.isArray(data) ? data : [data], opts: opts || {} }; return this }
  update(data, opts) { this._mut = { type: 'update', data: Array.isArray(data) ? data[0] : data, opts: opts || {} }; return this }
  delete() { this._mut = { type: 'delete' }; return this }

  _applyFilters(rows) {
    let out = rows.filter((r) => this._filters.every(([op, col, val]) => {
      const rv = r[col]
      if (op === 'eq') return val === null ? (rv === null || rv === undefined) : String(rv) === String(val)
      if (op === 'neq') return String(rv) !== String(val)
      if (op === 'gt') return rv > val
      if (op === 'gte') return rv >= val
      if (op === 'lt') return rv < val
      if (op === 'lte') return rv <= val
      if (op === 'in') return (val || []).some((v) => String(rv) === String(v))
      return true
    }))
    if (this._order) {
      out = [...out].sort((a, b) => {
        const av = a[this._order.col], bv = b[this._order.col]
        const cmp = av === bv ? 0 : (av > bv ? 1 : -1)
        return this._order.asc ? cmp : -cmp
      })
    }
    if (this._limitVal != null) out = out.slice(0, this._limitVal)
    return out
  }

  _project(row) {
    // supports `*, exams(title, max_score_per_section)` — one level of embedding.
    // NOTE: the split must be PARENTHESIS-AWARE — a naive split(',') breaks
    // multi-column embeds (`exams(title, max_score_per_section)` → the inner
    // comma silently kills the embed, so exam_title/max never resolve in the
    // demo and every exam line in reports collapses for no reason).
    if (this._selectCols === '*' || !this._selectCols) return { ...row }
    const splitTop = (s) => {
      const parts = []
      let depth = 0
      let cur = ''
      for (const ch of s) {
        if (ch === '(') depth++
        else if (ch === ')') depth--
        if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
      }
      parts.push(cur)
      return parts.map((p) => p.trim()).filter(Boolean)
    }
    const out = {}
    const parts = splitTop(this._selectCols)
    for (const part of parts) {
      const embed = part.match(/^(\w+)\(([^)]*)\)$/)
      if (embed) {
        const [, fkTableRaw, cols] = embed
        const fkTable = fkTableRaw === 'exams' ? 'exams' : fkTableRaw
        const fkCol = fkTable === 'exams' ? 'exam_id' : `${fkTableRaw.slice(0, -1)}_id`
        const ref = (this._db[fkTable] || []).find((r2) => r2.id === row[fkCol]) || null
        out[fkTableRaw] = ref ? Object.fromEntries(cols.split(',').map((c) => [c.trim(), ref[c.trim()]])) : null
      } else if (part === '*') {
        Object.assign(out, row)
      } else out[part] = row[part]
    }
    return out
  }

  async _exec() {
    const db = this._db
    if (!this._mut) {
      let rows = this._applyFilters(this._rows)
      rows = rows.map((r) => this._project(r))
      if (this._single) {
        if (rows.length === 0) {
          return this._maybe ? { data: null, error: null } : { data: null, error: { message: 'No rows found', code: 'PGRST116' } }
        }
        return { data: rows[0], error: null }
      }
      return { data: rows, error: null }
    }
    const mut = this._mut
    if (mut.type === 'insert') {
      const inserted = mut.data.map((row) => {
        const rec = { id: uid(), created_at: iso(), updated_at: iso(), ...row }
        db[this._table].push(rec)
        return rec
      })
      saveDb(db)
      inserted.forEach((r) => emitEvent(this._table, 'INSERT', r))
      const out = inserted.map((r) => this._project(r))
      if (this._single) return { data: out[0] || null, error: null }
      return { data: out, error: null }
    }
    if (mut.type === 'update') {
      const targets = this._applyFilters(db[this._table])
      const prevRows = targets.map((r) => ({ ...r }))
      targets.forEach((r) => { Object.assign(r, mut.data, { updated_at: iso() }) })
      saveDb(db)
      targets.forEach((r, i) => emitEvent(this._table, 'UPDATE', r, prevRows[i]))
      const out = targets.map((r) => this._project(r))
      if (this._count === 'exact') return { data: this._maybe ? (out[0] || null) : out, count: targets.length, error: null }
      if (this._single) return { data: out[0] || null, error: null }
      return { data: this._selectCols ? out : null, error: null }
    }
    if (mut.type === 'upsert') {
      const conflictCols = (mut.opts.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean)
      const results = []
      for (const row of mut.data) {
        let target = null
        if (conflictCols.length) {
          target = db[this._table].find((r) => conflictCols.every((c) => String(r[c]) === String(row[c])))
        } else if (row.id) {
          target = db[this._table].find((r) => r.id === row.id)
        }
        if (target) {
          const prev = { ...target }
          Object.assign(target, row, { updated_at: iso() })
          saveDb(db); emitEvent(this._table, 'UPDATE', target, prev)
          results.push(target)
        } else {
          const rec = { id: uid(), created_at: iso(), updated_at: iso(), ...row }
          db[this._table].push(rec)
          saveDb(db); emitEvent(this._table, 'INSERT', rec)
          results.push(rec)
        }
      }
      const out = results.map((r) => this._project(r))
      if (this._single) return { data: out[0] || null, error: null }
      return { data: out, error: null }
    }
    if (mut.type === 'delete') {
      const targets = this._applyFilters(db[this._table])
      db[this._table] = db[this._table].filter((r) => !targets.includes(r))
      saveDb(db)
      targets.forEach((r) => emitEvent(this._table, 'DELETE', null, r))
      return { data: null, error: null }
    }
    return { data: null, error: { message: 'unsupported mutation' } }
  }

  then(resolve, reject) { return this._exec().then(resolve, reject) }
  catch(rej) { return this._exec().then((r) => r, rej) }
  finally(fn) { return this._exec().finally(fn) }
}

// ── RPC implementations (mirror the SQL migrations) ─────────────────────────
// Task 44 — نتيجة تسليم بنفس شكل hw_quiz_result_json (migration 055)
function quizResultPayload(db, sub) {
  const quiz = db.homework_quizzes.find((q) => q.id === sub.quiz_id)
  const qs = db.homework_quiz_questions
    .filter((q) => q.quiz_id === sub.quiz_id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const pct = Number(sub.max_score) > 0 ? Math.round((Number(sub.score) / Number(sub.max_score)) * 100) : 0
  return {
    score: Number(sub.score), max_score: Number(sub.max_score), percentage: pct,
    correct_count: sub.correct_count, question_count: sub.question_count,
    submitted_at: sub.submitted_at, video_url: quiz?.video_url || null,
    quiz_title: quiz?.title || null,
    per_question: qs.map((q) => ({
      question_id: q.id, position: q.position, question_text: q.question_text, kind: q.kind,
      options: q.options, correct_options: q.correct_options, explanation: q.explanation,
      chosen: sub.answers?.[q.id] ?? null, is_correct:
        Array.isArray(sub.answers?.[q.id]) &&
        [...sub.answers[q.id]].sort().join(',') === [...(q.correct_options || [])].sort().join(','),
    })),
  }
}

// نفس منطق الرصد في submit_homework_quiz: مقارنة مصنفة للأسهم
function quizAnswerCorrect(chosen, correct) {
  if (!Array.isArray(chosen) || !Array.isArray(correct) || chosen.length === 0 || correct.length === 0) return false
  return [...chosen].sort().join(',') === [...correct].sort().join(',')
}

function quizNextSession(db, quiz) {
  const src = db.lesson_sessions.find((l) => l.id === quiz.lesson_session_id)
  if (!src) return null
  const srcTs = src.started_at || src.created_at || ''
  return db.lesson_sessions
    .filter((l) => l.teacher_id === quiz.teacher_id && l.group_name === src.group_name
      && (l.session_date > src.session_date
        || (l.session_date === src.session_date && (l.started_at || l.created_at || '') > srcTs)))
    .sort((a, b) => `${a.session_date}${a.started_at || a.created_at || ''}`.localeCompare(`${b.session_date}${b.started_at || b.created_at || ''}`))[0] || null
}

function quizRecordIntoSession(db, lesson, teacherId, studentId, pct, emit = true) {
  let row = db.attendance_records.find((r) => r.lesson_session_id === lesson.id && r.student_id === studentId)
  if (row) {
    if (['تم', 'مكتمل'].includes(row.homework_status || '')) return false
    const prev = { ...row }
    row.homework_status = 'تم'; row.homework_grade = pct; row.recorded_at = iso()
    saveDb(db)
    if (emit) emitEvent('attendance_records', 'UPDATE', row, prev)
    return true
  }
  row = { id: uid(), teacher_id: teacherId, student_id: studentId, status: 'لم يرصد', homework_status: 'تم', homework_grade: pct, lesson_session_id: lesson.id, recorded_at: iso(), attendance_date: lesson.session_date }
  db.attendance_records.push(row)
  saveDb(db)
  if (emit) emitEvent('attendance_records', 'INSERT', row)
  return true
}

function rpcCall(db, name, args) {
  const t = DEMO_TEACHER_ID
  const fail = (message) => ({ data: null, error: { message } })
  switch (name) {
    case 'my_workspace_owner': return { data: null, error: null }
    case 'my_support_session': return { data: null, error: null }
    case 'is_admin_user': return { data: false, error: null }
    case 'admin_teacher_stats': return { data: [], error: null }
    case 'search_teachers_for_onboarding': return { data: [], error: null }

    case 'upsert_lesson_attendance': {
      const lesson = db.lesson_sessions.find((l) => l.id === args.p_lesson_session_id)
      if (!lesson) return fail('الحصة غير موجودة')
      if (lesson.status !== 'open') return fail('الحصة دي منتهية بالفعل')
      if (!['حاضر', 'غائب', 'لم يرصد', 'متأخر'].includes(args.p_status)) return fail('حالة حضور غير صحيحة')
      let row = db.attendance_records.find((r) => r.lesson_session_id === lesson.id && r.student_id === args.p_student_id)
      if (row) {
        const prev = { ...row }
        row.status = args.p_status; row.recorded_at = iso()
        saveDb(db); emitEvent('attendance_records', 'UPDATE', row, prev)
      } else {
        row = { id: uid(), teacher_id: lesson.teacher_id, student_id: args.p_student_id, status: args.p_status, homework_status: 'لم يرصد', lesson_session_id: lesson.id, recorded_at: iso(), attendance_date: lesson.session_date }
        db.attendance_records.push(row)
        saveDb(db); emitEvent('attendance_records', 'INSERT', row)
      }
      return { data: { ...row }, error: null }
    }
    case 'upsert_lesson_homework': {
      const lesson = db.lesson_sessions.find((l) => l.id === args.p_lesson_session_id)
      if (!lesson) return fail('الحصة غير موجودة')
      if (lesson.status !== 'open') return fail('الحصة دي منتهية بالفعل')
      if (!['تم', 'مكتمل', 'ناقص', 'لم يتم', 'لم يرصد'].includes(args.p_homework_status)) return fail('حالة واجب غير صحيحة')
      let row = db.attendance_records.find((r) => r.lesson_session_id === lesson.id && r.student_id === args.p_student_id)
      if (row) {
        const prev = { ...row }
        row.homework_status = args.p_homework_status; row.recorded_at = iso()
        saveDb(db); emitEvent('attendance_records', 'UPDATE', row, prev)
      } else {
        row = { id: uid(), teacher_id: lesson.teacher_id, student_id: args.p_student_id, status: 'لم يرصد', homework_status: args.p_homework_status, lesson_session_id: lesson.id, recorded_at: iso(), attendance_date: lesson.session_date }
        db.attendance_records.push(row)
        saveDb(db); emitEvent('attendance_records', 'INSERT', row)
      }
      return { data: { ...row }, error: null }
    }
    case 'finalize_lesson_session': {
      const lesson = db.lesson_sessions.find((l) => l.id === args.p_lesson_session_id)
      if (!lesson) return fail('الحصة غير موجودة')
      if (lesson.status === 'completed') return { data: { already_finalized: true, present_count: 0, absent_count: 0 }, error: null }
      const groupStudents = db.students.filter((s) => s.group_name === lesson.group_name)
      let present = 0, absent = 0
      for (const s of groupStudents) {
        let row = db.attendance_records.find((r) => r.lesson_session_id === lesson.id && r.student_id === s.id)
        if (!row) {
          row = { id: uid(), teacher_id: lesson.teacher_id, student_id: s.id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lesson.id, recorded_at: iso(), attendance_date: lesson.session_date }
          db.attendance_records.push(row)
          emitEvent('attendance_records', 'INSERT', row)
        } else if (row.status !== 'حاضر') {
          const prev = { ...row }
          row.status = 'غائب'; row.recorded_at = iso()
          emitEvent('attendance_records', 'UPDATE', row, prev)
        }
        if (row.status === 'حاضر') present++; else absent++
        const prevStudent = { ...s }
        s.attendance_status = row.status; s.updated_at = iso()
        emitEvent('students', 'UPDATE', s, prevStudent)
      }
      lesson.status = 'completed'; lesson.ended_at = iso(); lesson.updated_at = iso()
      saveDb(db); emitEvent('lesson_sessions', 'UPDATE', lesson)
      return { data: { present_count: present, absent_count: absent }, error: null }
    }
    case 'mark_group_absences': {
      const lesson = db.lesson_sessions.find((l) => l.id === args.p_lesson_session_id)
      if (!lesson) return fail('الحصة غير موجودة')
      if (lesson.status !== 'open') return fail('الحصة دي منتهية بالفعل')
      let count = 0
      for (const s of db.students.filter((s) => s.group_name === lesson.group_name)) {
        const row = db.attendance_records.find((r) => r.lesson_session_id === lesson.id && r.student_id === s.id)
        if (!row || row.status === 'لم يرصد') {
          if (row) { const prev = { ...row }; row.status = 'غائب'; row.recorded_at = iso(); emitEvent('attendance_records', 'UPDATE', row, prev) }
          else {
            const nr = { id: uid(), teacher_id: lesson.teacher_id, student_id: s.id, status: 'غائب', homework_status: 'لم يرصد', lesson_session_id: lesson.id, recorded_at: iso(), attendance_date: lesson.session_date }
            db.attendance_records.push(nr); emitEvent('attendance_records', 'INSERT', nr)
          }
          count++
        }
      }
      saveDb(db)
      return { data: { marked: count }, error: null }
    }
    case 'resolve_student_by_qr': {
      const raw = String(args.p_payload || '').trim()
      const tokenMatch = raw.match(/([a-z0-9]{20})/i)
      const token = tokenMatch ? tokenMatch[1].toLowerCase() : null
      let student = null
      if (token) {
        const tok = db.student_qr_tokens.find((x) => x.token === token && !x.revoked_at)
        student = tok ? db.students.find((s) => s.id === tok.student_id) : null
      }
      if (!student) student = db.students.find((s) => s.id === raw)
      if (!student) return { data: { ok: false, error: 'student_not_found' }, error: null }
      const todayRow = db.attendance_records.find((r) => r.student_id === student.id && r.attendance_date === todayStr() && r.status === 'حاضر')
      return { data: { ok: true, student: { ...student }, today_status: todayRow ? 'حاضر' : (db.attendance_records.find((r) => r.student_id === student.id && r.attendance_date === todayStr())?.status || 'لم يرصد'), already_present_today: Boolean(todayRow) }, error: null }
    }
    case 'get_or_create_student_qr_token': {
      let tok = db.student_qr_tokens.find((x) => x.student_id === args.p_student_id && !x.revoked_at)
      if (!tok) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
        let token = ''
        do { token = Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('') } while (db.student_qr_tokens.some((x) => x.token === token))
        tok = { id: uid(), student_id: args.p_student_id, token, created_at: iso(), updated_at: iso(), revoked_at: null }
        db.student_qr_tokens.push(tok)
        saveDb(db)
      }
      return { data: tok.token, error: null }
    }
    case 'update_exam_max_score': {
      const exam = db.exams.find((e) => e.id === args.p_exam_id)
      if (!exam) return fail('الامتحان غير موجود')
      const newMax = Number(args.p_new_max)
      if (!Number.isFinite(newMax) || newMax <= 0) return fail('الدرجة النهائية غير صحيحة')
      const sectionCount = (exam.sections || []).length
      if (sectionCount && newMax % sectionCount !== 0) return fail(`الدرجة النهائية لازم تقبل القسمة على عدد أقسام الامتحان (${sectionCount})`)
      const prev = { ...exam }
      exam.max_score_per_section = newMax / (sectionCount || 1); exam.version += 1; exam.updated_at = iso()
      saveDb(db); emitEvent('exams', 'UPDATE', exam, prev)
      return { data: { ...exam }, error: null }
    }
    case 'update_student_exam_score': {
      const score = db.exam_scores.find((s) => s.id === args.p_score_id)
      if (!score) return fail('سجل الدرجة غير موجود')
      const exam = db.exams.find((e) => e.id === score.exam_id)
      const maxTotal = exam ? exam.max_score_per_section * (exam.sections || []).length : Infinity
      const newScore = Number(args.p_new_score)
      if (!Number.isFinite(newScore) || newScore < 0) return fail('الدرجة غير صحيحة')
      if (newScore > maxTotal) return fail(`الدرجة أكبر من النهائي (${maxTotal})`)
      const prev = { ...score }
      score.total_score = newScore; score.version += 1; score.updated_at = iso()
      saveDb(db); emitEvent('exam_scores', 'UPDATE', score, prev)
      return { data: { ...score }, error: null }
    }
    case 'send_announcement': {
      const announcement = { id: uid(), teacher_id: t, student_id: args.p_student_id || null, title: args.p_title, message: args.p_message, created_at: iso() }
      db.announcements.push(announcement)
      const targets = args.p_student_id ? db.students.filter((s) => s.id === args.p_student_id) : db.students
      const notifs = targets.map((s) => ({ id: uid(), teacher_id: t, student_id: s.id, title: args.p_title, body: args.p_message, category: 'announcement', deep_link: '/', is_read: false, created_at: iso() }))
      db.student_notifications.push(...notifs)
      saveDb(db)
      return { data: { ok: true, count: notifs.length }, error: null }
    }
    case 'mark_homework_done': return { data: { ok: true }, error: null }
    case 'get_portal_teacher_name': {
      // Real RPC (migration 028) returns TEXT — a bare display name string.
      const b = db.workspace_branding[0]
      return { data: b?.display_name || 'مدرس النخبة', error: null }
    }
    case 'get_student_portal_access': {
      const raw = String(args.p_token || '')
      const m = raw.match(/([a-z0-9]{20})/i)
      const tok = m ? db.student_qr_tokens.find((x) => x.token === m[1].toLowerCase() && !x.revoked_at) : null
      const student = tok ? db.students.find((s) => s.id === tok.student_id) : null
      return { data: student ? { ok: true, student: { id: student.id, name: student.name } } : { ok: false }, error: null }
    }
    case 'get_homework_quiz_public': {
      // Mirrors migration_055: questions WITHOUT correct_options/explanation
      // before submission; video locked; device-submitted → stored result.
      const token = String(args.p_token || '').trim()
      const quiz = db.homework_quizzes.find((q) => q.access_token === token && q.is_published)
      if (!quiz) return { data: { status: 'not_found', message: 'الرابط غير صالح أو الواجب مش منشور بعد' }, error: null }
      const device = String(args.p_device || '').trim().slice(0, 120)
      const deviceSub = device
        ? db.homework_quiz_submissions.find((s) => s.quiz_id === quiz.id && s.device_fingerprint === device)
        : null
      const src = db.lesson_sessions.find((l) => l.id === quiz.lesson_session_id)
      const qs = db.homework_quiz_questions
        .filter((q) => q.quiz_id === quiz.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      return {
        data: {
          status: deviceSub ? 'already_submitted_device' : 'ok',
          quiz: {
            id: quiz.id, title: quiz.title, instructions: quiz.instructions,
            group_name: src?.group_name || '', session_date: src?.session_date || null,
            video_url: deviceSub ? (quiz.video_url || null) : null, question_count: qs.length,
          },
          questions: deviceSub ? [] : qs.map((q) => ({
            id: q.id, position: q.position, question_text: q.question_text, kind: q.kind, options: q.options,
          })),
          result: deviceSub ? quizResultPayload(db, deviceSub) : null,
        },
        error: null,
      }
    }
    case 'submit_homework_quiz': {
      const token = String(args.p_token || '').trim()
      const quiz = db.homework_quizzes.find((q) => q.access_token === token && q.is_published)
      if (!quiz) return { data: { status: 'not_found', message: 'الرابط غير صالح أو الواجب مش منشور بعد' }, error: null }
      if (!args.p_answers || typeof args.p_answers !== 'object') return fail('بيانات ناقصة — أعد تحميل الصفحة')
      const src = db.lesson_sessions.find((l) => l.id === quiz.lesson_session_id)
      if (!src) return fail('حصة الواجب غير موجودة')
      // الرقم: عربي/هندي → لاتيني + أرقام فقط (نفس translate/regexp في الـ SQL)
      const normalize = (s) => {
        let out = String(s ?? '')
        const ar = '٠١٢٣٤٥٦٧٨٩'; const fa = '۰۱۲۳۴۵۶۷۸۹'
        for (let i = 0; i < 10; i++) { out = out.split(ar[i]).join(String(i)).split(fa[i]).join(String(i)) }
        return out.replace(/\D/g, '')
      }
      const num = normalize(args.p_student_number)
      let student = null
      if (num.length >= 4) student = db.students.find((s) => s.teacher_id === quiz.teacher_id && s.group_name === src.group_name && normalize(s.phone) === num)
      if (!student && String(args.p_student_number || '').trim()) {
        const code = String(args.p_student_number).trim()
        student = db.students.find((s) => s.teacher_id === quiz.teacher_id && s.group_name === src.group_name && (s.code || '').trim() === code)
      }
      if (!student) return { data: { status: 'student_not_found', message: 'الرقم ده مش موجود في مجموعة الواجب — اتأكد منه أو كلم المستر' }, error: null }
      const already = db.homework_quiz_submissions.find((s) => s.quiz_id === quiz.id && s.student_id === student.id)
      if (already) {
        return { data: { status: 'already_submitted', message: 'الواجب ده اتسلّم بالفعل من الطالب ده — مش مسموح بالإعادة', student_name: student.name, result: quizResultPayload(db, already) }, error: null }
      }
      const device = String(args.p_device || '').trim().slice(0, 120)
      if (device && db.homework_quiz_submissions.some((s) => s.quiz_id === quiz.id && s.device_fingerprint === device)) {
        return { data: { status: 'device_used', message: 'الجهاز ده سلّم الواجب ده بالفعل — كل جهاز ليه تسليم واحد بس' }, error: null }
      }
      // الرصد على "السيرفر" — نفس منطق الـ SQL بالظبط
      const qs = db.homework_quiz_questions.filter((q) => q.quiz_id === quiz.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      let score = 0, max = 0, correct = 0
      qs.forEach((q) => {
        const pts = 1
        max += pts
        if (quizAnswerCorrect(args.p_answers?.[q.id], q.correct_options)) { score += pts; correct++ }
      })
      const pct = max > 0 ? Math.round((score / max) * 100) : 0
      const sub = {
        id: uid(), quiz_id: quiz.id, teacher_id: quiz.teacher_id, student_id: student.id,
        device_fingerprint: device, answers: args.p_answers, score, max_score: max,
        correct_count: correct, question_count: qs.length, submitted_at: iso(),
      }
      db.homework_quiz_submissions.push(sub)
      // التسجيل التلقائي في الحصة اللي وراها
      const next = quizNextSession(db, quiz)
      if (next) quizRecordIntoSession(db, next, quiz.teacher_id, student.id, pct)
      // إشعارات (نفس الجداول الفعلية)
      db.teacher_notification_events.push({
        id: uid(), teacher_id: quiz.teacher_id, event_type: 'student_submission', title: 'واجب إلكتروني جديد',
        body: `${student.name} سلّم «${quiz.title || 'واجب الحصة'}» — ${score} من ${max} (${pct}%)`,
        related_student_id: student.id, is_read: false, created_at: iso(),
      })
      db.student_notifications.push({
        id: uid(), teacher_id: quiz.teacher_id, student_id: student.id, title: 'تم استلام واجبك',
        body: `نتيجتك في «${quiz.title || 'واجب الحصة'}»: ${score} من ${max} (${pct}%)`,
        category: 'homework', deep_link: '/', is_read: false, created_at: iso(),
      })
      saveDb(db)
      return { data: { status: 'ok', student_name: student.name, result: quizResultPayload(db, sub) }, error: null }
    }
    case 'sync_homework_quiz_results': {
      const lesson = db.lesson_sessions.find((l) => l.id === args.p_lesson_session_id)
      if (!lesson) return { data: { applied: 0 }, error: null }
      let applied = 0
      const srcIds = db.lesson_sessions
        .filter((l) => l.teacher_id === lesson.teacher_id && l.group_name === lesson.group_name
          && (l.session_date < lesson.session_date
            || (l.session_date === lesson.session_date && (l.started_at || l.created_at || '') < (lesson.started_at || lesson.created_at || ''))))
        .map((l) => l.id)
      const quizzes = db.homework_quizzes.filter((q) => q.is_published && srcIds.includes(q.lesson_session_id))
      for (const quiz of quizzes) {
        for (const sub of db.homework_quiz_submissions.filter((s) => s.quiz_id === quiz.id)) {
          const pct = Number(sub.max_score) > 0 ? Math.round((Number(sub.score) / Number(sub.max_score)) * 100) : 0
          if (quizRecordIntoSession(db, lesson, lesson.teacher_id, sub.student_id, pct, false)) applied++
        }
      }
      return { data: { applied }, error: null }
    }
    case 'get_student_portal_data': {
      // Shape mirrors the production RPC (migrations 019/023/037) — the portal
      // reads: student, ranks, whatsapp_number, attendance, lesson_attendance,
      // behavior, announcements, exam_scores, session_today, schedule,
      // homework_tasks, homework_status, notifications, lesson_sessions,
      // branding, unreadNotificationCount.
      const raw = String(args.p_token || '')
      const m = raw.match(/([a-z0-9]{20})/i)
      const tok = m ? db.student_qr_tokens.find((x) => x.token === m[1].toLowerCase() && !x.revoked_at) : null
      const student = tok ? db.students.find((s) => s.id === tok.student_id) : null
      if (!student) return { data: null, error: { message: 'student_not_found' } }
      const settings = db.teacher_settings[0] || {}
      const branding = db.workspace_branding[0] || {}
      const scores = db.exam_scores.filter((s) => s.student_id === student.id).map((s) => {
        const exam = db.exams.find((e) => e.id === s.exam_id)
        return { ...s, exam_title: exam?.title, exam_max_per_section: exam?.max_score_per_section, exam_sections: exam?.sections }
      })
      const logs = db.behavior_logs.filter((l) => l.student_id === student.id).slice(-20)
      const notifs = db.student_notifications.filter((n) => n.student_id === student.id).slice(-10)
      const todayLesson = db.lesson_sessions.find((l) => l.group_name === student.group_name && l.session_date === todayStr())
      const attendance = db.attendance_records.filter((r) => r.student_id === student.id)
      const lessonAttendance = todayLesson ? attendance.filter((r) => r.lesson_session_id === todayLesson.id) : []
      const tasks = db.homework_tasks.filter((t) => t.group_name === student.group_name)
      return {
        data: {
          student: { ...student },
          ranks: settings.ranks || [],
          whatsapp_number: settings.whatsapp_number || '',
          report_fields: settings.report_fields || [],
          attendance,
          lesson_attendance: lessonAttendance,
          behavior: logs,
          announcements: db.announcements.filter((a) => !a.student_id || a.student_id === student.id),
          exam_scores: scores,
          session_today: todayLesson || null,
          lesson_sessions: db.lesson_sessions.filter((l) => l.group_name === student.group_name),
          schedule: db.group_schedule.filter((g) => g.group_name === student.group_name),
          homework_tasks: tasks,
          homework_status: [],
          notifications: notifs,
          unreadNotificationCount: notifs.filter((n) => !n.is_read).length,
          branding: {
            display_name: branding.display_name || '',
            center_name: branding.center_name || '',
            logo_url: branding.logo_url || '',
            portal_header_text: branding.portal_header_text || '',
            portal_welcome_message: branding.portal_welcome_message || '',
          },
        },
        error: null,
      }
    }
    case 'get_student_standalone_exams': {
      // Mirrors migration_052: the student's standalone-exam score rows
      // (took it = has a row) + the exam's editable grade scale so the
      // portal computes the grade name client-side like the teacher panel.
      const raw = String(args.p_token || '')
      const m = raw.match(/([a-z0-9]{20})/i)
      const tok = m ? db.student_qr_tokens.find((x) => x.token === m[1].toLowerCase() && !x.revoked_at) : null
      const student = tok ? db.students.find((s) => s.id === tok.student_id) : null
      if (!student) return { data: [], error: null }
      const rows = db.standalone_exam_scores
        .filter((r) => r.student_id === student.id)
        .map((r) => {
          const exam = db.standalone_exams.find((e) => e.id === r.exam_id)
          return {
            exam_id: r.exam_id,
            title: exam?.title || 'امتحان',
            exam_date: exam?.exam_date,
            exam_status: exam?.status || 'open',
            score: r.score,
            max_score: exam?.max_score ?? 100,
            grade_scale: exam?.grade_scale || [],
            graded_at: r.updated_at,
          }
        })
      return { data: rows, error: null }
    }
    default:
      return { data: null, error: { message: `demo: RPC ${name} not implemented` } }
  }
}

// ── auth (demo: any email/password ≥ 6 chars signs in) ───────────────────────
const authSubs = new Set()
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
function writeSession(s) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY) } catch {}
  // supabase-js calls onAuthStateChange(event, session) — the session itself
  // is the second argument, NOT a wrapper object.
  authSubs.forEach((cb) => { try { cb(s ? 'SIGNED_IN' : 'SIGNED_OUT', s) } catch {} })
}
function ensureProfile(db, email, fullName) {
  let profile = db.profiles.find((p) => p.email === email)
  if (!profile) {
    profile = {
      id: DEMO_TEACHER_ID, full_name: fullName || email.split('@')[0] || 'مدرس النخبة',
      email, phone: '201000000000', is_admin: false, is_verified: true,
      subscription_status: 'active', subscription_expires_at: iso(60 * 24 * 365),
      account_type: 'teacher', created_at: iso(-60 * 24 * 90),
    }
    db.profiles.push(profile)
    saveDb(db)
  }
  return profile
}

// ── the client ───────────────────────────────────────────────────────────────
const db = loadDb()

export function isDemoMode() { return true }
export function resetDemoData() {
  try { localStorage.removeItem(DB_KEY) } catch {}
  location.reload()
}

const demoClient = {
  __isDemo: true,
  from(table) { return new Query(db, table) },
  rpc(name, args = {}) {
    return (async () => rpcCall(db, name, args))()
  },
  channel(topic) {
    // Each .on('postgres_changes', { table }, cb) registration receives ONLY
    // that table's events — same contract as Supabase Realtime. (Forwarding
    // all tables to all handlers broke attendance maps with exam payloads.)
    const registrations = [] // [{ table, cb }]
    const chan = {
      on(type, filter, cb) {
        const table = filter && typeof filter === 'object' ? filter.table : null
        registrations.push({ table, cb })
        return chan
      },
      subscribe(cb) { if (typeof cb === 'function') setTimeout(() => cb('SUBSCRIBED'), 30); return chan },
      unsubscribe() { return Promise.resolve('ok') },
    }
    const listener = (table, payload) => {
      registrations.forEach(({ table: t, cb }) => {
        if (!t || t === table) { try { cb(payload) } catch { /* isolate */ } }
      })
    }
    chan.__listener = listener
    chan.__topic = topic
    listeners.add(listener)
    return chan
  },
  removeChannel(chan) { if (chan && chan.__listener) listeners.delete(chan.__listener); return Promise.resolve('ok') },
  removeAllChannels() { listeners.clear(); return Promise.resolve('ok') },
  auth: {
    async getSession() {
      const s = readSession()
      return { data: { session: s }, error: null }
    },
    onAuthStateChange(cb) {
      authSubs.add(cb)
      return { data: { subscription: { unsubscribe() { authSubs.delete(cb) } } } }
    },
    async signInWithPassword({ email, password }) {
      if (!email || !password || password.length < 6) return { data: {}, error: { message: 'بيانات الدخول غير صحيحة (كلمة المرور 6 أحرف على الأقل في البيئة التجريبية)' } }
      const profile = ensureProfile(db, String(email).toLowerCase())
      const session = { access_token: 'demo-token', user: { id: profile.id, email: profile.email, user_metadata: { full_name: profile.full_name } } }
      writeSession(session)
      return { data: { session, user: session.user }, error: null }
    },
    async signUp({ email, password, options }) {
      const profile = ensureProfile(db, String(email).toLowerCase(), options?.data?.full_name)
      const session = { access_token: 'demo-token', user: { id: profile.id, email: profile.email, user_metadata: options?.data || {} } }
      writeSession(session)
      return { data: { session, user: session.user }, error: null }
    },
    async signOut() { writeSession(null); return { error: null } },
    async updateUser({ password }) {
      if (password && password.length < 6) return { error: { message: 'كلمة المرور قصيرة' } }
      return { error: null }
    },
    async resetPasswordForEmail() { return { data: {}, error: null } },
  },
  functions: { async invoke() { return { data: null, error: { message: 'demo: no edge functions' } } } },
  storage: { from() { return { async upload() { return { data: null, error: { message: 'demo: no storage' } } }, getPublicUrl() { return { data: { publicUrl: '' } } } } } },
}

export default demoClient
