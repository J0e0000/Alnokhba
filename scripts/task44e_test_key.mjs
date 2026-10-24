// Task 44e — sanity test for parseAnswerKey
import { parseAnswerKey, parseQuestionsText } from '/home/z/my-project/frontend/src/lib/hwQuiz.js'

const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  console.log(ok ? 'PASS' : `FAIL ${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)
}

let r = parseAnswerKey('أ ب ج د')
eq(r.keys.map(k => k.index), [0, 1, 2, 3], 'letters spaced')

r = parseAnswerKey('1-أ 2-ج 3-ب')
eq(r.keys.map(k => k.index), [0, 2, 1], 'numbered key')

r = parseAnswerKey('صح غلط صح')
eq(r.keys.map(k => k.index), [0, 1, 0], 'true/false')

r = parseAnswerKey('a,b,c')
eq(r.keys.map(k => k.index), [0, 1, 2], 'latin a,b,c')

r = parseAnswerKey('أ 0 و')
eq(r.keys.map(k => k.skip || k.index), [0, true, 5], 'skip token')

r = parseAnswerKey('١ ٢ ٣')
eq(r.keys.map(k => k.index), [0, 1, 2], 'arabic-indic digits')

r = parseAnswerKey('ا ب ج')
eq(r.keys.map(k => k.index), [0, 1, 2], 'bare alef = أ')

r = parseAnswerKey('ز')
eq(r.keys.map(k => k.index), [null], 'unknown letter')

r = parseAnswerKey('')
eq(r.keys.length, 0, 'empty')

// regression: question parser still fine
r = parseQuestionsText('1) عاصمة مصر؟\nأ) القاهرة\nب) الإسكندرية\nالإجابة: أ')
eq([r.questions.length, r.questions[0].correct], [1, 0], 'parser regression')
console.log('DONE')
