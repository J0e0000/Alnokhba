// Quick logic test for qbImport.parseTextToQuestions and qbRandomize
// Run with: node /home/z/my-project/scripts/test_qb_logic.mjs

import { parseTextToQuestions } from '/home/z/my-project/app/src/lib/qbImport.js'
import { buildVersionItems, generateVersionLabels, remapCorrectIndex, shuffle, permutation } from '/home/z/my-project/app/src/lib/qbRandomize.js'

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name) }
}

console.log('\n-- parseTextToQuestions --')
const text = `Q: ما عاصمة مصر؟
A) القاهرة
B) الإسكندرية
C) الجيزة
D) أسوان
ANS: A
MARKS: 2
DIFF: easy
EXPL: القاهرة هي عاصمة مصر.

Q: كم 2+2؟
ANS: 4`
const parsed = parseTextToQuestions(text)
ok('parses 2 questions', parsed.length === 2)
ok('first is mcq', parsed[0].type === 'mcq')
ok('first has 4 choices', parsed[0].choices.length === 4)
ok('first correct is index 0', parsed[0].correct_answer.index === 0)
ok('first marks = 2', parsed[0].marks === 2)
ok('first difficulty = easy', parsed[0].difficulty === 'easy')
ok('first has explanation', parsed[0].explanation?.includes('القاهرة'))
ok('second is numerical', parsed[1].type === 'numerical')
ok('second correct value = 4', parsed[1].correct_answer.value === 4)

console.log('\n-- True/False parsing --')
const tfText = `Q: السماء زرقاء.
ANS: true`
const tf = parseTextToQuestions(tfText)
ok('tf parsed', tf.length === 1)
ok('tf type = true_false', tf[0].type === 'true_false')
ok('tf correct = true', tf[0].correct_answer.value === true)

console.log('\n-- Fallback: each line is a short_answer --')
const fallback = parseTextToQuestions('ما اسم عاصمة فرنسا؟\nكم عدد الكواكب؟')
ok('fallback parses 2', fallback.length === 2)
ok('fallback type = short_answer', fallback[0].type === 'short_answer')

console.log('\n-- shuffle + permutation --')
const s = shuffle([1, 2, 3, 4, 5])
ok('shuffle keeps same set', s.sort().join(',') === '1,2,3,4,5')
const orig = [1, 2, 3, 4, 5]
shuffle(orig)
ok('shuffle does not mutate original', orig.join(',') === '1,2,3,4,5')
const p = permutation(4)
ok('permutation length = 4', p.length === 4)
ok('permutation is a permutation', p.sort((a, b) => a - b).join(',') === '0,1,2,3')

console.log('\n-- buildVersionItems --')
const flatItems = [
  { section_id: 's1', question_id: 'q1', question: { id: 'q1', type: 'mcq', choices: ['a', 'b', 'c', 'd'] } },
  { section_id: 's1', question_id: 'q2', question: { id: 'q2', type: 'mcq', choices: ['x', 'y'] } },
  { section_id: 's1', question_id: 'q3', question: { id: 'q3', type: 'essay' } },
]
const vItems = buildVersionItems(flatItems, { shuffle_questions: true, shuffle_choices: true })
ok('version has 3 items', vItems.length === 3)
ok('every mcq item has choice_order', vItems.filter((v) => v.choice_order.length > 0).length === 2)
ok('essay item has empty choice_order', vItems.find((v) => v.question_id === 'q3').choice_order.length === 0)
ok('all question_ids preserved', new Set(vItems.map((v) => v.question_id)).size === 3)

console.log('\n-- remapCorrectIndex --')
const newIdx = remapCorrectIndex(0, [2, 0, 1])
ok('remap finds new index', newIdx === 1)
ok('remap returns original when no perm', remapCorrectIndex(2, []) === 2)

console.log('\n-- generateVersionLabels --')
ok('3 labels = A,B,C', generateVersionLabels(3).join(',') === 'A,B,C')
ok('1 label = A', generateVersionLabels(1).join(',') === 'A')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
