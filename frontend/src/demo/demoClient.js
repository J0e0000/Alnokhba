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

const DB_KEY = 'alnokhba_demo_db_v6'
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
    status: 'open', sections: [], version: 1, created_at: iso(-60 * 24 * 48), updated_at: iso(-60 * 24 * 48),
  }
  const saScores = students.slice(0, 4).map((s, i) => ({
    id: uid(), teacher_id: t, exam_id: saExam.id, student_id: s.id,
    score: [88, 74, 62, 45][i], section_scores: null, version: 1, created_at: iso(-60 * 24 * 47), updated_at: iso(-60 * 24 * 47),
  }))
  // امتحان منفصل بأقسام (056) — partial-section percentage semantics:
  // سلمى امتحنت القسم الأول فقط → نسبتها تُحسب على المتاح (10/20 = 50%)
  const saExamSections = {
    id: uid(), teacher_id: t, title: 'امتحان تجريبي بأقسام', exam_date: dayStr(-1),
    group_name: '', max_score: 50,
    sections: [{ name: 'القسم الأول', max: 20 }, { name: 'القسم الثاني', max: 30 }],
    grade_scale: [{ name: 'ممتاز', min: 80 }, { name: 'جيد', min: 70 }, { name: 'مقبول', min: 60 }, { name: 'ضعيف', min: 0 }],
    status: 'completed', version: 1, created_at: iso(-60 * 24 * 30), updated_at: iso(-60 * 24 * 30),
  }
  const saSectionScores = [
    { id: uid(), teacher_id: t, exam_id: saExamSections.id, student_id: students[0].id, score: 45, section_scores: [18, 27], version: 2, created_at: iso(-60 * 24 * 29), updated_at: iso(-60 * 24 * 28) },
    { id: uid(), teacher_id: t, exam_id: saExamSections.id, student_id: students[2].id, score: 10, section_scores: [10, null], version: 1, created_at: iso(-60 * 24 * 29), updated_at: iso(-60 * 24 * 29) },
  ]
  const standalone_exams = [saExam, saExamSections]
  const standalone_exam_scores = [...saScores, ...saSectionScores]
  // واجب تفاعلي MCQ (056/058) — سؤالان + سؤال نصه اختياري (الواجب في الكتاب)
  // + فيديو شرح مقفول (يظهر بعد التسليم فقط)
  const hwTask = {
    id: uid(), teacher_id: t, title: 'واجب الوحدة الأولى — اختيار الإجابة',
    description: 'اختار الإجابة الصحيحة لكل سؤال من صفحة الواجبات.',
    group_name: null, due_date: dayStr(3), video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    questions: [
      { text: 'كم ناتج 7 × 8؟', choices: ['54', '56', '58', '48'], correct: 1, marks: 5 },
      { text: 'عاصمة مصر؟', choices: ['الإسكندرية', 'القاهرة'], correct: 1, marks: 5 },
    ],
    max_score: 10, status: 'published', version: 1,
    created_at: iso(-60 * 24 * 2), updated_at: iso(-60 * 24 * 2),
  }
  // واجب تاني منشور بدون تسليم — جاهز لتجربة صفحة /hw كاملة (أسئلة نصها فاضي)
  const hwTask2 = {
    id: uid(), teacher_id: t, title: 'واجب الكتاب — صفحة ٦٠',
    description: 'الواجب في الكتاب — حدد الإجابة من عندك.',
    group_name: null, due_date: dayStr(5), video_url: null,
    questions: [
      { text: '', choices: ['أ', 'ب', 'ج', 'د'], correct: 2, marks: 1 },
      { text: '', choices: ['صح', 'غلط'], correct: 0, marks: 1 },
      { text: 'أكمل: مصر عاصمتها؟', choices: ['القاهرة', 'أسوان'], correct: 0, marks: 1 },
    ],
    max_score: 3, status: 'published', version: 1,
    created_at: iso(-60 * 24), updated_at: iso(-60 * 24),
  }
  const hwTaskSimple = {
    id: uid(), teacher_id: t, title: 'حل أسئلة الكتاب صفحة ٤٥',
    group_name: groups[0], due_date: dayStr(2), questions: null,
    max_score: 0, status: 'published', version: 1,
    created_at: iso(-60 * 24), updated_at: iso(-60 * 24),
  }
  const homework_tasks = [hwTask, hwTask2, hwTaskSimple]
  const homework_submissions = [
    { id: uid(), teacher_id: t, task_id: hwTask.id, student_id: students[0].id, answers: [1, 1], score: 10, max_score: 10, correct_count: 2, question_count: 2, results: [true, true], submitted_at: iso(-60 * 20), updated_at: iso(-60 * 20) },
  ]
  // امتحان أونلاين (057) — مؤقت سيرفر + محاولة واحدة لكل طالب + تسليم نموذجي
  const oeExam = {
    id: uid(), teacher_id: t, title: 'امتحان أونلاين — الوحدة الأولى',
    instructions: 'اختار الإجابة الصحيحة — الوقت بيكمل حتى لو قفلت الصفحة.',
    group_name: null, status: 'open',
    opens_at: null, closes_at: iso(60 * 24 * 7),
    duration_minutes: 15,
    questions: [
      { text: 'ما ناتج 12 × 3؟', choices: ['36', '34', '38', '30'], correct: 0, marks: 5 },
      { text: 'أكبر كوكب في المجموعة الشمسية؟', choices: ['الأرض', 'المشتري', 'زحل'], correct: 1, marks: 5 },
      { text: 'جمع 25 + 17؟', choices: ['41', '42', '43'], correct: 1, marks: 10 },
    ],
    shuffle_questions: false, max_score: 20, question_count: 3,
    created_at: iso(-60 * 5), updated_at: iso(-60 * 5),
  }
  const oeAttempt = {
    id: uid(), exam_id: oeExam.id, student_id: students[1].id, teacher_id: t,
    status: 'submitted', started_at: iso(-60 * 4), deadline_at: iso(-60 * 4 + 15),
    submitted_at: iso(-60 * 4 + 9), answers: [0, 1, 0], question_order: [0, 1, 2],
    score: 10, max_score: 20, correct_count: 2, question_count: 3,
    results: [true, true, false], updated_at: iso(-60 * 4 + 9),
  }
  const online_exams = [oeExam]
  const online_exam_attempts = [oeAttempt]
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
    standalone_exam_audit_logs: [], homework_submissions,
    workspace_branding: [branding], broadcast_messages: broadcasts,
    student_qr_tokens: [], student_notifications: [], teacher_notification_events: [],
    session_logs: [], homework_tasks, homework_task_status: [], announcements: [],
    online_exams, online_exam_attempts,
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
// ── Online exams (057) helpers — mirror migration 057 semantics ──
function demoStudentFromToken(db, raw) {
  const m = String(raw || '').match(/([a-z0-9]{20})/i)
  const tok = m ? db.student_qr_tokens.find((x) => x.token === m[1].toLowerCase() && !x.revoked_at) : null
  return tok ? db.students.find((s) => s.id === tok.student_id) : null
}
function demoGradeOnline(exam, attempt) {
  const qs = Array.isArray(exam.questions) ? exam.questions : []
  const order = Array.isArray(attempt.question_order) && attempt.question_order.length === qs.length ? attempt.question_order : qs.map((_, i) => i)
  const answers = Array.isArray(attempt.answers) ? attempt.answers : []
  let score = 0; let max = 0; let correct = 0
  const results = qs.map((_, pos) => {
    const q = qs[order[pos]] || qs[pos]
    const marks = Math.max(Number(q.marks) || 1, 0)
    max += marks
    const choice = answers[pos] != null ? Number(answers[pos]) : null
    const ok = choice != null && Number(q.correct) === choice
    if (ok) { score += marks; correct += 1 }
    return ok
  })
  return { score, max, correct, count: qs.length, results }
}
function demoExpireOnline(db, exam, a) {
  const g = demoGradeOnline(exam, a)
  const prev = { ...a }
  a.status = 'expired'; a.submitted_at = iso(0); a.updated_at = iso(0)
  a.score = g.score; a.max_score = g.max; a.correct_count = g.correct; a.question_count = g.count; a.results = g.results
  emitEvent('online_exam_attempts', 'UPDATE', a, prev)
  saveDb(db)
  return { done: true, status: 'expired', score: a.score, max_score: a.max_score, correct_count: g.correct, question_count: g.count, results: g.results, submitted_at: a.submitted_at }
}
function demoSafeQuestions(exam, order) {
  const qs = Array.isArray(exam.questions) ? exam.questions : []
  const ord = Array.isArray(order) && order.length === qs.length ? order : qs.map((_, i) => i)
  return ord.map((ri) => ({ text: qs[ri].text, choices: qs[ri].choices, marks: qs[ri].marks }))
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
      // TASK44/056: safe homework projection — questions WITHOUT the answer
      // key, published-only, null-group tasks included, submission summary.
      const tasks = db.homework_tasks
        .filter((t) => (t.group_name === student.group_name || t.group_name == null) && t.status === 'published')
        .map((t) => {
          const sub = db.homework_submissions.find((hs) => hs.task_id === t.id && hs.student_id === student.id) || null
          return {
            id: t.id, title: t.title, due_date: t.due_date, created_at: t.created_at,
            description: t.description || null, status: t.status, max_score: t.max_score,
            // 058: فيديو الشرح مقفول قبل التسليم — السيرفر مش بيبعت غير بعد
            video_url: sub ? (t.video_url || null) : null,
            has_questions: t.questions != null,
            questions: t.questions
              ? t.questions.map((q) => ({ text: q.text, choices: q.choices, marks: q.marks }))
              : null,
            submission: sub
              ? (({ score, max_score, correct_count, question_count, submitted_at, results, answers }) => ({ score, max_score, correct_count, question_count, submitted_at, results, answers }))(sub)
              : null,
          }
        })
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
          const sections = Array.isArray(exam?.sections) ? exam.sections : []
          const ss = Array.isArray(r.section_scores) ? r.section_scores : []
          let attemptedMax = exam?.max_score ?? 100
          let attemptedCount = null
          if (sections.length > 0) {
            attemptedMax = 0; attemptedCount = 0
            sections.forEach((sec, i) => {
              if (ss[i] != null) { attemptedMax += Number(sec.max) || 0; attemptedCount += 1 }
            })
          }
          const score = Number(r.score) || 0
          const percentage = attemptedMax > 0 ? Math.round((score / attemptedMax) * 1000) / 10 : 0
          const scale = exam?.grade_scale || []
          const grade = (scale.find((g) => percentage >= (Number(g.min) || 0)) || scale[scale.length - 1] || {}).name || ''
          return {
            exam_id: r.exam_id,
            title: exam?.title || 'امتحان',
            exam_date: exam?.exam_date,
            exam_status: exam?.status || 'open',
            score,
            max_score: exam?.max_score ?? 100,
            grade_scale: scale,
            graded_at: r.updated_at,
            sections,
            section_scores: r.section_scores ?? null,
            sections_count: sections.length,
            attempted_count: attemptedCount,
            attempted_max: attemptedMax,
            percentage,
            grade,
          }
        })
      // 055 release gate: exams still open (under grading) are NOT published
      return { data: rows.filter((x) => x.exam_status === 'completed'), error: null }
    }
    case 'save_standalone_score': {
      // Mirrors migration 056: version-checked upsert with section validation.
      const exam = db.standalone_exams.find((e) => e.id === args.p_exam_id)
      if (!exam) return { data: null, error: { message: 'exam_not_found' } }
      const student = db.students.find((s) => s.id === args.p_student_id && s.teacher_id === exam.teacher_id)
      if (!student) return { data: null, error: { message: 'student_not_in_workspace' } }
      if (exam.status !== 'open') return { data: null, error: { message: 'exam_closed' } }
      let existing = db.standalone_exam_scores.find((r) => r.exam_id === args.p_exam_id && r.student_id === args.p_student_id)
      if (existing && args.p_expected_score_version != null && existing.version !== args.p_expected_score_version) {
        return { data: null, error: { message: 'version_conflict' } }
      }
      const sections = Array.isArray(exam.sections) ? exam.sections : []
      let sectionScores = null
      let score
      if (sections.length > 0) {
        const arr = Array.isArray(args.p_section_scores) ? args.p_section_scores : null
        if (!arr || arr.length !== sections.length) return { data: null, error: { message: 'section_scores_required' } }
        score = 0
        sectionScores = arr.map((v, i) => {
          if (v == null) return null
          const n = Number(v) || 0
          const smax = Number(sections[i].max) || 0
          if (n < 0 || n > smax) throw { message: 'section_score_out_of_range' }
          score += n
          return n
        })
        if (sectionScores.every((v) => v == null)) return { data: null, error: { message: 'empty_section_scores' } }
      } else {
        score = Math.max(0, Number(args.p_score) || 0)
        if (score > (exam.max_score ?? 100)) return { data: null, error: { message: 'invalid_score' } }
      }
      const prev = existing ? { ...existing } : null
      if (existing) {
        existing.score = score; existing.section_scores = sectionScores
        existing.version = (existing.version || 1) + 1; existing.updated_at = iso(0)
      } else {
        existing = { id: uid(), teacher_id: exam.teacher_id, exam_id: exam.id, student_id: args.p_student_id, score, section_scores: sectionScores, version: 1, created_at: iso(0), updated_at: iso(0) }
        db.standalone_exam_scores.push(existing)
      }
      db.standalone_exam_audit_logs.push({ id: uid(), teacher_id: exam.teacher_id, actor_id: null, change_type: 'student_score',
        exam_id: exam.id, student_id: args.p_student_id,
        previous_value: prev ? { score: prev.score, section_scores: prev.section_scores, version: prev.version } : null,
        new_value: { score: existing.score, section_scores: existing.section_scores, version: existing.version },
        reason: args.p_reason || null, exam_version: exam.version, created_at: iso(0) })
      saveDb(db); emitEvent('standalone_exam_scores', prev ? 'UPDATE' : 'INSERT', existing, prev)
      return { data: { ...existing }, error: null }
    }
    case 'ungrade_standalone_student': {
      const exam = db.standalone_exams.find((e) => e.id === args.p_exam_id)
      if (!exam) return { data: null, error: { message: 'exam_not_found' } }
      const idx = db.standalone_exam_scores.findIndex((r) => r.exam_id === args.p_exam_id && r.student_id === args.p_student_id)
      if (idx >= 0) {
        const [removed] = db.standalone_exam_scores.splice(idx, 1)
        db.standalone_exam_audit_logs.push({ id: uid(), teacher_id: exam.teacher_id, actor_id: null, change_type: 'ungrade',
          exam_id: exam.id, student_id: args.p_student_id,
          previous_value: { score: removed.score, section_scores: removed.section_scores, version: removed.version },
          new_value: null, reason: args.p_reason || 'إلغاء درجة', exam_version: exam.version, created_at: iso(0) })
        saveDb(db); emitEvent('standalone_exam_scores', 'DELETE', null, removed)
      }
      return { data: true, error: null }
    }
    case 'update_standalone_exam': {
      const patch = args.p_patch || {}
      const exam = db.standalone_exams.find((e) => e.id === args.p_exam_id)
      if (!exam) return { data: null, error: { message: 'exam_not_found' } }
      if (args.p_expected_version != null && exam.version !== args.p_expected_version) {
        return { data: null, error: { message: 'version_conflict' } }
      }
      const prev = { ...exam }
      if (patch.title != null) exam.title = String(patch.title).trim()
      if (patch.exam_date != null) exam.exam_date = patch.exam_date
      if (patch.group_name !== undefined) exam.group_name = patch.group_name || null
      if (patch.status != null) exam.status = patch.status
      if (patch.grade_scale != null) exam.grade_scale = patch.grade_scale
      if (Array.isArray(patch.sections)) {
        if (patch.sections.length > 0) {
          exam.sections = patch.sections
          exam.max_score = patch.sections.reduce((a, s) => a + (Number(s.max) || 0), 0)
        } else {
          exam.sections = []
          if (patch.max_score != null) exam.max_score = Number(patch.max_score) || exam.max_score
        }
      } else if (patch.max_score != null) {
        exam.max_score = Number(patch.max_score) || exam.max_score
      }
      exam.version = (exam.version || 1) + 1
      exam.updated_at = iso(0)
      const atype = patch.status != null ? 'status' : patch.max_score != null ? 'max_score' : Array.isArray(patch.sections) ? 'sections' : patch.grade_scale != null ? 'scale' : 'meta'
      db.standalone_exam_audit_logs.push({ id: uid(), teacher_id: exam.teacher_id, actor_id: null, change_type: atype,
        exam_id: exam.id, student_id: null,
        previous_value: Object.fromEntries(Object.keys(patch).map((k) => [k, prev[k]])),
        new_value: Object.fromEntries(Object.keys(patch).map((k) => [k, exam[k === 'max_score' ? 'max_score' : k]])),
        reason: args.p_reason || null, exam_version: exam.version, created_at: iso(0) })
      saveDb(db); emitEvent('standalone_exams', 'UPDATE', exam, prev)
      return { data: { exam: { ...exam }, version: exam.version }, error: null }
    }
    case 'submit_homework_task_answers': {
      const raw = String(args.p_token || '')
      const m = raw.match(/([a-z0-9]{20})/i)
      const tok = m ? db.student_qr_tokens.find((x) => x.token === m[1].toLowerCase() && !x.revoked_at) : null
      const student = tok ? db.students.find((s) => s.id === tok.student_id) : null
      if (!student) return { data: null, error: { message: 'invalid_token' } }
      const task = db.homework_tasks.find((x) => x.id === args.p_task_id)
      if (!task || task.teacher_id !== student.teacher_id) return { data: null, error: { message: 'task_not_found' } }
      // 058: التسليم مرة واحدة — اللي سلّم ياخد نتيجته المحفوظة من غير إعادة
      const existingSub = db.homework_submissions.find((x) => x.task_id === task.id && x.student_id === student.id)
      if (existingSub) {
        return { data: { status: 'already_submitted', task_id: task.id, score: existingSub.score, max_score: existingSub.max_score, correct_count: existingSub.correct_count, question_count: existingSub.question_count, submitted_at: existingSub.submitted_at, results: existingSub.results ?? null, answers: existingSub.answers }, error: null }
      }
      if (task.status !== 'published') return { data: null, error: { message: 'task_closed' } }
      if (!Array.isArray(task.questions) || task.questions.length === 0) return { data: null, error: { message: 'no_questions' } }
      if (task.group_name != null && task.group_name !== student.group_name) return { data: null, error: { message: 'not_for_your_group' } }
      const answers = Array.isArray(args.p_answers) ? args.p_answers : null
      if (!answers || answers.length > task.questions.length) return { data: null, error: { message: 'invalid_answers' } }
      // validate choice indices BEFORE grading (mirror the SQL RPC)
      const badIdx = task.questions.findIndex((q, i) => {
        if (answers[i] == null) return false
        const n = Number(answers[i])
        return !Number.isInteger(n) || n < 0 || n >= (Array.isArray(q.choices) ? q.choices.length : 0)
      })
      if (badIdx >= 0) return { data: null, error: { message: 'invalid_answers' } }
      let score = 0; let max = 0; let correctCount = 0
      const results = task.questions.map((q, i) => {
        const marks = Math.max(Number(q.marks) || 1, 0)
        max += marks
        const choice = answers[i] != null ? Number(answers[i]) : null
        const ok = choice != null && Number(q.correct) === choice
        if (ok) { score += marks; correctCount += 1 }
        return ok
      })
      const sub = { id: uid(), teacher_id: student.teacher_id, task_id: task.id, student_id: student.id, answers, score, max_score: max, correct_count: correctCount, question_count: task.questions.length, results, submitted_at: iso(0), updated_at: iso(0) }
      db.homework_submissions.push(sub)
      // 058: تسجيل تلقائي في الحصة الجاية — «واجب إلكتروني: X/Y (P%)»
      let nextRecorded = false
      const nextSession = db.lesson_sessions
        .filter((l) => l.teacher_id === student.teacher_id && l.group_name === student.group_name
          && l.session_date >= todayStr() && (l.status || 'open') !== 'completed')
        .sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)))[0]
      if (nextSession) {
        const pct = max > 0 ? Math.round((score / max) * 100) : 0
        const hwText = `واجب إلكتروني: ${score}/${max} (${pct}%)`
        const dayRow = db.attendance_records.find((r) => r.student_id === student.id && r.attendance_date === nextSession.session_date)
        if (dayRow) {
          dayRow.homework_status = dayRow.homework_status || hwText
          dayRow.recorded_at = iso(0)
        } else {
          db.attendance_records.push({
            id: uid(), teacher_id: student.teacher_id, student_id: student.id,
            status: 'لم يرصد', homework_status: hwText, lesson_session_id: nextSession.id,
            attendance_date: nextSession.session_date, recorded_at: iso(0),
          })
        }
        nextRecorded = true
      }
      saveDb(db)
      return { data: { status: 'ok', task_id: task.id, score, max_score: max, correct_count: correctCount, question_count: task.questions.length, submitted_at: sub.submitted_at, results, answers, next_session_recorded: nextRecorded }, error: null }
    }
    // ═══ الامتحانات الأونلاين (057) — مؤقت سيرفر + حفظ تلقائي + تسليم ═══
    case 'get_student_online_exams': {
      const student = demoStudentFromToken(db, args.p_token)
      if (!student) return fail('invalid_token')
      // lazy-expire: أي محاولة جارية عدّى موعدها تتصحح من آخر حفظ
      db.online_exam_attempts.forEach((a) => {
        if (a.student_id === student.id && a.status === 'in_progress' && Date.now() >= new Date(a.deadline_at).getTime()) {
          const exam = db.online_exams.find((e) => e.id === a.exam_id)
          if (exam) demoExpireOnline(db, exam, a)
        }
      })
      const exams = db.online_exams
        .filter((e) => e.teacher_id === student.teacher_id
          && (e.group_name == null || e.group_name === student.group_name)
          && (e.status === 'open' || db.online_exam_attempts.some((a) => a.exam_id === e.id && a.student_id === student.id)))
        .map((e) => {
          const a = db.online_exam_attempts.find((x) => x.exam_id === e.id && x.student_id === student.id)
          const available = e.status === 'open'
            && (!e.opens_at || Date.now() >= new Date(e.opens_at).getTime())
            && (!e.closes_at || Date.now() < new Date(e.closes_at).getTime())
            && (!a || a.status === 'in_progress')
          return {
            id: e.id, title: e.title, instructions: e.instructions, status: e.status,
            group_name: e.group_name, duration_minutes: e.duration_minutes,
            max_score: e.max_score, question_count: e.question_count,
            opens_at: e.opens_at, closes_at: e.closes_at, available,
            my: a ? {
              status: a.status, started_at: a.started_at, deadline_at: a.deadline_at,
              submitted_at: a.submitted_at, score: a.score, max_score: a.max_score,
              correct_count: a.correct_count, question_count: a.question_count,
            } : null,
          }
        })
      return { data: { server_now: iso(0), exams }, error: null }
    }
    case 'start_online_exam': {
      const student = demoStudentFromToken(db, args.p_token)
      if (!student) return fail('invalid_token')
      const exam = db.online_exams.find((e) => e.id === args.p_exam_id)
      if (!exam || exam.teacher_id !== student.teacher_id) return fail('exam_not_found')
      if (exam.group_name != null && exam.group_name !== student.group_name) return fail('not_for_your_group')
      let a = db.online_exam_attempts.find((x) => x.exam_id === exam.id && x.student_id === student.id)
      if (a && a.status !== 'in_progress') {
        return { data: { done: true, status: a.status, score: a.score, max_score: a.max_score, correct_count: a.correct_count, question_count: a.question_count, results: a.results, submitted_at: a.submitted_at }, error: null }
      }
      if (a && Date.now() >= new Date(a.deadline_at).getTime()) {
        return { data: demoExpireOnline(db, exam, a), error: null }
      }
      if (a) {
        // استكمال — نفس الترتيب والإجابات المحفوظة
        return { data: { resumed: true, attempt_id: a.id, deadline_at: a.deadline_at, server_now: iso(0), duration_minutes: exam.duration_minutes, order: a.question_order, answers: a.answers, questions: demoSafeQuestions(exam, a.question_order) }, error: null }
      }
      if (exam.status !== 'open'
        || (exam.opens_at && Date.now() < new Date(exam.opens_at).getTime())
        || (exam.closes_at && Date.now() >= new Date(exam.closes_at).getTime())) {
        return fail('exam_not_open')
      }
      const order = exam.shuffle_questions
        ? exam.questions.map((_, i) => i).sort(() => Math.random() - 0.5)
        : exam.questions.map((_, i) => i)
      a = {
        id: uid(), exam_id: exam.id, student_id: student.id, teacher_id: student.teacher_id,
        status: 'in_progress', started_at: iso(0), deadline_at: iso(exam.duration_minutes),
        submitted_at: null, answers: exam.questions.map(() => null), question_order: order,
        score: null, max_score: null, correct_count: null, question_count: exam.question_count,
        results: null, updated_at: iso(0),
      }
      db.online_exam_attempts.push(a)
      emitEvent('online_exam_attempts', 'INSERT', a, null)
      saveDb(db)
      return { data: { started: true, attempt_id: a.id, deadline_at: a.deadline_at, server_now: iso(0), duration_minutes: exam.duration_minutes, order, answers: a.answers, questions: demoSafeQuestions(exam, order) }, error: null }
    }
    case 'autosave_online_exam_answers': {
      const student = demoStudentFromToken(db, args.p_token)
      if (!student) return fail('invalid_token')
      const exam = db.online_exams.find((e) => e.id === args.p_exam_id)
      if (!exam || exam.teacher_id !== student.teacher_id) return fail('exam_not_found')
      const a = db.online_exam_attempts.find((x) => x.exam_id === exam.id && x.student_id === student.id)
      if (!a) return fail('no_attempt')
      if (a.status !== 'in_progress') return { data: { ok: false, closed: true, status: a.status }, error: null }
      if (Date.now() >= new Date(a.deadline_at).getTime()) {
        return { data: { ok: false, expired: true, ...demoExpireOnline(db, exam, a) }, error: null }
      }
      const answers = Array.isArray(args.p_answers) ? args.p_answers : null
      if (!answers || answers.length > exam.questions.length) return fail('invalid_answers')
      const badIdx = exam.questions.findIndex((_, i) => {
        if (answers[i] == null) return false
        const n = Number(answers[i])
        return !Number.isInteger(n) || n < 0 || n >= (Array.isArray(exam.questions[i].choices) ? exam.questions[i].choices.length : 0)
      })
      if (badIdx >= 0) return fail('invalid_answers')
      const prev = { ...a }
      a.answers = answers; a.updated_at = iso(0)
      emitEvent('online_exam_attempts', 'UPDATE', a, prev)
      saveDb(db)
      return { data: { ok: true, saved_at: iso(0) }, error: null }
    }
    case 'submit_online_exam': {
      const student = demoStudentFromToken(db, args.p_token)
      if (!student) return fail('invalid_token')
      const exam = db.online_exams.find((e) => e.id === args.p_exam_id)
      if (!exam || exam.teacher_id !== student.teacher_id) return fail('exam_not_found')
      const a = db.online_exam_attempts.find((x) => x.exam_id === exam.id && x.student_id === student.id)
      if (!a) return fail('no_attempt')
      if (a.status !== 'in_progress') {
        return { data: { done: true, status: a.status, score: a.score, max_score: a.max_score, correct_count: a.correct_count, question_count: a.question_count, results: a.results, submitted_at: a.submitted_at }, error: null }
      }
      if (Date.now() > new Date(a.deadline_at).getTime() + 10000) {
        // انتهى الوقت — التصحيح من آخر autosave على السيرفر
        return { data: demoExpireOnline(db, exam, a), error: null }
      }
      const answers = Array.isArray(args.p_answers) ? args.p_answers : null
      if (!answers || answers.length > exam.questions.length) return fail('invalid_answers')
      const badIdx = exam.questions.findIndex((_, i) => {
        if (answers[i] == null) return false
        const n = Number(answers[i])
        return !Number.isInteger(n) || n < 0 || n >= (Array.isArray(exam.questions[i].choices) ? exam.questions[i].choices.length : 0)
      })
      if (badIdx >= 0) return fail('invalid_answers')
      a.answers = answers
      const g = demoGradeOnline(exam, a)
      const prev = { ...a }
      a.status = 'submitted'; a.submitted_at = iso(0); a.updated_at = iso(0)
      a.score = g.score; a.max_score = g.max; a.correct_count = g.correct; a.question_count = g.count; a.results = g.results
      emitEvent('online_exam_attempts', 'UPDATE', a, prev)
      saveDb(db)
      return { data: { done: true, status: 'submitted', score: g.score, max_score: g.max, correct_count: g.correct, question_count: g.count, results: g.results, submitted_at: a.submitted_at }, error: null }
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
