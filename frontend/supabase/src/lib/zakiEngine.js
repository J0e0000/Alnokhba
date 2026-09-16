/**
 * zakiEngine.js — عقل زكي 🧠
 * ============================================================================
 * State machine + event bus + response generator for the "Zaki" assistant.
 * Adapted for El No5ba app sections: dashboard, students, sessions, exams, games, reports
 * ============================================================================
 */

// ─── Moods ───
export const MOODS = {
  IDLE: 'idle',
  THINKING: 'thinking',
  EXPLAINING: 'explaining',
  HAPPY: 'happy',
  CELEBRATING: 'celebrating',
  WARNING: 'warning',
}

// ─── Pages Zaki knows about (matches SECTIONS in Dashboard.jsx) ───
export const PAGES = {
  DASHBOARD: 'dashboard',
  STUDENTS: 'students',
  SESSIONS: 'sessions',
  EXAMS: 'exams',
  GAMES: 'games',
  REPORTS: 'reports',
}

// ─── Response dictionary (Arabic default, English fallback) ───
const RESPONSES = {
  ar: {
    pageIntro: {
      [PAGES.DASHBOARD]: 'أهلاً بيك! 👋 هنا بتشوف نظرة عامة على كل حاجة — الطلاب، الحضور، والنقاط.',
      [PAGES.STUDENTS]: 'من هنا تقدر تضيف طلاب جداد وتشوف بيانات كل طالب وترتيبه.',
      [PAGES.SESSIONS]: 'من هنا تقدر تسجل حضور الطلاب بضغطة واحدة، أو بالـ QR Code كمان، وتكتب درس اليوم والواجب.',
      [PAGES.EXAMS]: 'هنا تقدر تعمل امتحانات وتسجل درجات الطلاب فيها.',
      [PAGES.GAMES]: 'ألعاب تعليمية ممتعة! اختر لعبة وطالب وابدأ التحدي 🎮',
      [PAGES.REPORTS]: 'من هنا تقدر تشوف تقارير جاهزة عن أداء كل طالب أو المجموعة كلها.',
    },
    save: ['تمام 👌 كده اتحفظت', 'حفظنا كل حاجة ✅', 'خلصنا، البيانات محفوظة 💾'],
    delete: ['تم الحذف 🗑️', 'اتشالت من غير مشاكل'],
    error: {
      generic: 'في مشكلة صغيرة، خليني أساعدك 🤔',
      network: 'يظهر في مشكلة في الاتصال بالإنترنت، جرب تاني',
      validation: 'ناقص بيانات شوية، راجع الفورم وجرب تاني',
    },
    confusion: [
      'محتاج مساعدة؟ 😊 أنا هنا لو عايز حاجة',
      'واخد وقتك؟ ولا تحب أوريك الخطوة دي؟',
    ],
    tips: {
      [PAGES.SESSIONS]: 'تلميح: تقدر تستخدم سكانر الـ QR عشان تسجل الحضور أسرع 📷',
      [PAGES.STUDENTS]: 'تلميح: ابعت كل طالب رابط بوابته الخاصة وهيقدر يشوف نقاطه وواجباته',
      [PAGES.EXAMS]: 'تلميح: النتائج بتظهر تلقائي في بوابة كل طالب بعد ما تسجلها',
    },
    tutorialWelcome: 'أهلاً بيك في النخبة! أنا زكي 🤖 هعرّفك على النظام في دقيقتين بس، جاهز؟',
    tutorialEnd: 'كده خلصنا الجولة! 🎉 لو محتاج أي حاجة تاني أنا موجود دايماً في الركن ده.',
    tutorialSkip: 'تمام، لو حبيت تبدأ الجولة تاني اضغط عليا في أي وقت 👋',
  },
  en: {
    pageIntro: {
      [PAGES.DASHBOARD]: 'Welcome! 👋 Here you get an overview of everything — students, attendance, and points.',
      [PAGES.STUDENTS]: 'Here you can add new students and see each one\'s data and rank.',
      [PAGES.SESSIONS]: 'Here you can mark attendance in one click, scan QR codes, and log today\'s lesson & homework.',
      [PAGES.EXAMS]: 'Here you can create exams and record student scores.',
      [PAGES.GAMES]: 'Fun educational games! Pick a game and a student to start the challenge 🎮',
      [PAGES.REPORTS]: 'Here you can view ready-made reports for any student or the whole group.',
    },
    save: ['Done 👌 Saved!', 'All saved ✅'],
    delete: ['Deleted 🗑️', 'Removed successfully'],
    error: {
      generic: 'Small hiccup — let me help 🤔',
      network: 'Looks like a connection issue, try again',
      validation: 'Some fields are missing, check the form',
    },
    confusion: ['Need help? 😊 I\'m right here', 'Taking your time? Want me to show you?'],
    tips: {
      [PAGES.SESSIONS]: 'Tip: use the QR scanner to mark attendance faster 📷',
      [PAGES.STUDENTS]: 'Tip: send each student their own portal link so they can track points and homework',
      [PAGES.EXAMS]: 'Tip: results show up automatically in each student\'s portal',
    },
    tutorialWelcome: 'Welcome to Al-Nokhba! I\'m Zaki 🤖 I\'ll show you around in just 2 minutes, ready?',
    tutorialEnd: 'That\'s the tour! 🎉 Need anything else, I\'m always here in the corner.',
    tutorialSkip: 'No problem — click me anytime to restart the tour 👋',
  },
}

// ─── Guided tutorial script ───
const TUTORIAL_STEPS = [
  { page: PAGES.DASHBOARD, mood: MOODS.HAPPY, textKey: 'tutorialWelcome', selector: null },
  { page: PAGES.STUDENTS, mood: MOODS.EXPLAINING, text: { ar: 'ده صفحة الطلاب — من هنا تضيف طالب جديد بضغطة زرار "+"', en: 'This is the Students page — tap "+" to add a new student' }, selector: '[data-tour="add-student-btn"]' },
  { page: PAGES.SESSIONS, mood: MOODS.EXPLAINING, text: { ar: 'وده الحصة — اضغط على اسم الطالب عشان تسجله حاضر أو غائب فورًا، واكتب درس اليوم والواجب', en: 'This is Sessions — tap a student to mark attendance, and log today\'s lesson & homework' }, selector: '[data-tour="attendance-list"]' },
  { page: PAGES.EXAMS, mood: MOODS.EXPLAINING, text: { ar: 'من هنا تعمل امتحان جديد وتسجل الدرجات، وهتظهر تلقائي لكل طالب', en: 'Create an exam here and record scores — they show up automatically for each student' }, selector: '[data-tour="create-exam-btn"]' },
  { page: PAGES.REPORTS, mood: MOODS.EXPLAINING, text: { ar: 'وده مكان التقارير الجاهزة — تقدر تنزلها PDF بضغطة واحدة', en: 'Here are ready-made reports — download as PDF in one click' }, selector: '[data-tour="reports-download-btn"]' },
  { page: PAGES.DASHBOARD, mood: MOODS.CELEBRATING, textKey: 'tutorialEnd', selector: null },
]

// ─── Simple event bus ───
function createEmitter() {
  const listeners = {}
  return {
    on(evt, cb) { (listeners[evt] ||= []).push(cb); return () => listeners[evt] = listeners[evt].filter((f) => f !== cb) },
    emit(evt, payload) { (listeners[evt] || []).forEach((cb) => cb(payload)) },
  }
}

// ─── Zaki engine ───
function createZakiEngine() {
  const emitter = createEmitter()

  const state = {
    lang: 'ar',
    mood: MOODS.IDLE,
    message: '',
    page: PAGES.DASHBOARD,
    visible: true,
    tutorial: { active: false, stepIndex: 0 },
    seenPages: new Set(),
  }

  let confusionTimer = null
  let moodResetTimer = null
  const CONFUSION_DELAY_MS = 10000
  const MOOD_HOLD_MS = 3200

  function t(key) {
    return RESPONSES[state.lang]?.[key] ?? RESPONSES.ar[key]
  }

  function pick(arrOrKey) {
    const arr = Array.isArray(arrOrKey) ? arrOrKey : t(arrOrKey)
    if (!Array.isArray(arr)) return arr
    return arr[Math.floor(Math.random() * arr.length)]
  }

  function notify() {
    emitter.emit('change', { ...state })
  }

  function say(message, mood = MOODS.EXPLAINING, { hold = true } = {}) {
    state.message = message
    state.mood = mood
    notify()
    clearTimeout(moodResetTimer)
    if (hold) {
      moodResetTimer = setTimeout(() => {
        state.mood = MOODS.IDLE
        notify()
      }, MOOD_HOLD_MS)
    }
    resetConfusionTimer()
  }

  function resetConfusionTimer() {
    clearTimeout(confusionTimer)
    if (state.tutorial.active) return
    confusionTimer = setTimeout(() => {
      const msg = pick(RESPONSES[state.lang].confusion)
      state.message = msg
      state.mood = MOODS.THINKING
      notify()
    }, CONFUSION_DELAY_MS)
  }

  const zaki = {
    MOODS,
    PAGES,

    on: emitter.on,

    getState: () => ({ ...state }),

    setLang(lang) {
      state.lang = lang === 'en' ? 'en' : 'ar'
      notify()
    },

    setVisible(v) {
      state.visible = v
      notify()
    },

    setPage(page) {
      state.page = page
      resetConfusionTimer()
      const isFirstVisit = !state.seenPages.has(page)
      if (isFirstVisit) {
        state.seenPages.add(page)
        const intro = RESPONSES[state.lang].pageIntro[page]
        if (intro) say(intro, MOODS.EXPLAINING)
      } else {
        state.mood = MOODS.IDLE
        state.message = ''
        notify()
      }
    },

    event(type, payload = {}) {
      resetConfusionTimer()
      switch (type) {
        case 'save':
          say(pick('save'), payload.big ? MOODS.CELEBRATING : MOODS.HAPPY)
          break
        case 'delete':
          say(pick('delete'), MOODS.HAPPY)
          break
        case 'error': {
          const kind = payload.kind || 'generic'
          const msg = RESPONSES[state.lang].error[kind] || RESPONSES[state.lang].error.generic
          say(payload.message || msg, MOODS.WARNING)
          break
        }
        case 'thinking':
          say(payload.message || '', MOODS.THINKING, { hold: false })
          break
        case 'click':
        case 'navigation':
          break
        case 'tip': {
          const tip = RESPONSES[state.lang].tips[state.page]
          if (tip) say(tip, MOODS.EXPLAINING)
          break
        }
        case 'celebrate':
          say(payload.message || pick('save'), MOODS.CELEBRATING)
          break
        default:
          break
      }
    },

    startTutorial() {
      state.tutorial = { active: true, stepIndex: 0 }
      clearTimeout(confusionTimer)
      const step = TUTORIAL_STEPS[0]
      state.page = step.page
      state.mood = step.mood
      state.message = step.textKey ? t(step.textKey) : step.text[state.lang]
      notify()
      emitter.emit('tutorial:step', { index: 0, step })
    },

    nextTutorialStep() {
      if (!state.tutorial.active) return
      const nextIndex = state.tutorial.stepIndex + 1
      if (nextIndex >= TUTORIAL_STEPS.length) {
        zaki.endTutorial()
        return
      }
      state.tutorial.stepIndex = nextIndex
      const step = TUTORIAL_STEPS[nextIndex]
      state.page = step.page
      state.mood = step.mood
      state.message = step.textKey ? t(step.textKey) : step.text[state.lang]
      notify()
      emitter.emit('tutorial:step', { index: nextIndex, step })
    },

    prevTutorialStep() {
      if (!state.tutorial.active || state.tutorial.stepIndex === 0) return
      const prevIndex = state.tutorial.stepIndex - 1
      state.tutorial.stepIndex = prevIndex
      const step = TUTORIAL_STEPS[prevIndex]
      state.page = step.page
      state.mood = step.mood
      state.message = step.textKey ? t(step.textKey) : step.text[state.lang]
      notify()
      emitter.emit('tutorial:step', { index: prevIndex, step })
    },

    skipTutorial() {
      state.tutorial = { active: false, stepIndex: 0 }
      say(t('tutorialSkip'), MOODS.IDLE, { hold: true })
      emitter.emit('tutorial:end', { skipped: true })
    },

    endTutorial() {
      state.tutorial = { active: false, stepIndex: 0 }
      say(t('tutorialEnd'), MOODS.CELEBRATING)
      emitter.emit('tutorial:end', { skipped: false })
      resetConfusionTimer()
    },

    getTutorialSteps: () => TUTORIAL_STEPS,
    getTutorialProgress: () => ({ index: state.tutorial.stepIndex, total: TUTORIAL_STEPS.length, active: state.tutorial.active }),

    ping() {
      resetConfusionTimer()
    },
  }

  return zaki
}

export const zaki = createZakiEngine()
export default zaki
