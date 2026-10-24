// Task 44d unit tests — parser + AI mapping + analytics (bun)
import { parseQuestionsText, mapAiQuestions, buildQuizAnalytics } from '../frontend/src/lib/hwQuiz.js'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name) } }

// 1) full-form parse: numbered question + lettered options + answer line
const r1 = parseQuestionsText(`1) عاصمة مصر؟
أ) القاهرة
ب) الإسكندرية
الإجابة: أ

2) الشمس تشرق من الشرق
صح / غلط
الاجابه: صح`)
ok('two questions parsed', r1.questions.length === 2)
ok('q1 text', r1.questions[0].text === 'عاصمة مصر؟')
ok('q1 choices', r1.questions[0].choices.join('|') === 'القاهرة|الإسكندرية')
ok('q1 correct = أ', r1.questions[0].correct === 0)
ok('q2 is TF', r1.questions[1].choices.join('|') === 'صح|غلط' && r1.questions[1].correct === 0)
ok('no warnings', r1.warnings.length === 0)

// 2) text OPTIONAL: answer-sheet only (الواجب في الكتاب)
const r2 = parseQuestionsText(`أ) 
ب) 
ج) 
د) 
الإجابة: ج`)
ok('answer-sheet only → 1 question', r2.questions.length === 1)
ok('empty text kept', r2.questions[0].text === '')

// 3) ✅ mark inside an option
const r3 = parseQuestionsText(`كم 2+2؟
أ) 3
ب) 4 ✅`)
ok('check-marked option becomes correct', r3.questions[0].correct === 1)

// 4) garbage → warning, zero crash
const r4 = parseQuestionsText('سطر عشوائي بدون أي شكل')
ok('garbage yields warning', r4.warnings.length > 0)

// 5) AI mapping: options → choices + correct index (Arabic labels)
const ai = mapAiQuestions([
  { question_text: 'س1', kind: 'mcq', options: ['القاهرة', 'أسوان'], correct_options: ['أسوان'] },
  { question_text: 'س2', kind: 'true_false', options: ['صح', 'غلط'], correct_options: ['غلط'] },
])
ok('AI q1 correct index', ai[0].correct === 1 && ai[0].choices.length === 2)
ok('AI TF maps to صح/غلط', ai[1].choices.join('|') === 'صح|غلط' && ai[1].correct === 1)

// 6) analytics: wrong-count per question + problem sort
const questions = [
  { text: 'س1', choices: ['أ', 'ب'], correct: 0, marks: 1 },
  { text: '', choices: ['صح', 'غلط'], correct: 1, marks: 1 },
]
const subs = [
  { answers: [1, 1], score: 2, max_score: 2 },
  { answers: [1, 0], score: 1, max_score: 2 },
  { answers: [0, 1], score: 2, max_score: 2 },
]
const an = buildQuizAnalytics(subs, questions)
ok('q1 wrong=2', an.perQuestion[0].wrong === 2)
ok('q2 wrong=1', an.perQuestion[1].wrong === 1)
ok('problem order', an.problemQuestions[0].index === 0)
ok('avgPct', an.avgPct === 83)

console.log(`RESULT: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
