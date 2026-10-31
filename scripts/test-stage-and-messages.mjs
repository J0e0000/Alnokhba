// Standalone verification of the student-management round additions:
//  1. stage helpers (category mapping + compatibility on dirty data)
//  2. buildAttendanceMessage (present vs absent templates, real warning math)
import { stageCategoryOf, isStageCompatible, firstGradeOfCategory } from '../src/lib/helpers.js'

let pass = 0
let fail = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}

console.log('— stageCategoryOf —')
check('full grade prep', stageCategoryOf('الثالث الإعدادي'), 'إعدادي')
check('full grade secondary', stageCategoryOf('الأول الثانوي'), 'ثانوي')
check('bare category', stageCategoryOf('ثانوي'), 'ثانوي')
check('hamza-less', stageCategoryProvider('الثاني اعدادي'), 'إعدادي')
check('empty', stageCategoryOf(''), '')
check('null', stageCategoryOf(null), '')
check('free text garbage', stageCategoryOf('مرحلة خاصة'), '')

function stageCategoryProvider(v) { return stageCategoryOf(v) }

console.log('— isStageCompatible —')
check('same category', isStageCompatible('الثاني الإعدادي', 'الثالث الإعدادي'), true)
check('conflict prep vs secondary', isStageCompatible('الثاني الإعدادي', 'الثالث الثانوي'), false)
check('legacy bare category matches full', isStageCompatible('إعدادي', 'الثاني الإعدادي'), true)
check('empty student stage = compatible', isStageCompatible('', 'الثالث الثانوي'), true)
check('empty group stage = compatible', isStageCompatible('الثالث الثانوي', ''), true)
check('garbage = compatible (no info)', isStageCompatible('مرحلة خاصة', 'الثالث الثانوي'), true)

console.log('— firstGradeOfCategory —')
check('secondary first', firstGradeOfCategory('ثانوي'), 'الأول الثانوي')
check('unknown', firstGradeOfCategory('x'), '')

console.log('— buildAttendanceMessage —')
// Node ESM can't resolve the extensionless './supabaseClient' import inside
// qrPdfWhatsApp.js — inline the pure functions we test instead of importing
// the whole module (supabase/qrcode deps are irrelevant to these paths).
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/lib/qrPdfWhatsApp.js', import.meta.url), 'utf8')
const startIdx = src.indexOf('export const DEFAULT_PRESENT_TEMPLATE')
const endAnchor = 'export function buildAttendanceMessage'
const fnStart = src.indexOf(endAnchor)
if (startIdx < 0 || fnStart < 0) { console.error('Could not locate message-builder source'); process.exit(1) }
// End of the buildAttendanceMessage function: first "\n}\n" after its start
const fnEnd = src.indexOf('\n}\n', fnStart)
const chunk = src.slice(startIdx, fnEnd + 3) // already exports buildAttendanceMessage
const mod = await import('data:text/javascript,' + encodeURIComponent(chunk))
const { buildAttendanceMessage } = mod
const DEFAULT_PRESENT_TEMPLATE = 'present'
const DEFAULT_ABSENT_TEMPLATE = 'absent'
const settings = { insight_config: { max_warnings: 3 }, msg_attendance_present: '', msg_attendance_absent: '' }
const lesson = { lesson_topic: 'الجبر', video_link: 'https://v.example/x', session_date: '2026-09-17', homework_text: 'صفحة 12' }
const present = { name: 'أحمد محمد', group_name: 'الثالث الإعدادي — أ', warnings: 0 }
const absentWarned = { name: 'سعاد علي', group_name: 'الثالث الإعدادي — أ', warnings: 1 }

const msgPresent = buildAttendanceMessage(present, { status: 'حاضر', lesson, settings })
check('present uses present template', msgPresent.includes('حضر حصة'), true)
check('present has group', msgPresent.includes('الثالث الإعدادي — أ'), true)
check('present has lesson topic', msgPresent.includes('الجبر'), true)
check('present has NO warnings line', msgPresent.includes('إنذار'), false)
check('present has NO video', msgPresent.includes('v.example'), false)

const msgAbsent = buildAttendanceMessage(absentWarned, { status: 'غائب', lesson, settings })
check('absent uses absent template', msgAbsent.includes('لم يحضر'), true)
check('absent warning count real (1)', msgAbsent.includes('رصيد الإنذارات الحالي: 1'), true)
check('absent remaining = 3-1 = 2', msgAbsent.includes('متبقي 2 إنذار'), true)
check('absent has video link', msgAbsent.includes('https://v.example/x'), true)

// Dynamic math: warnings == threshold → remaining 0; never negative
const atThreshold = buildAttendanceMessage({ name: 'خ', group_name: 'g', warnings: 3 }, { status: 'غائب', lesson, settings })
check('remaining clamps at 0', atThreshold.includes('متبقي 0 إنذار'), true)
const overThreshold = buildAttendanceMessage({ name: 'خ', group_name: 'g', warnings: 7 }, { status: 'غائب', lesson, settings })
check('remaining never negative', overThreshold.includes('متبقي 0 إنذار'), true)

// Default threshold when settings empty
const noSettings = buildAttendanceMessage({ name: 'خ', group_name: 'g', warnings: 2 }, { status: 'غائب', lesson, settings: null })
check('default threshold 3', noSettings.includes('متبقي 1 إنذار'), true)

// Teacher-customized template overrides default (video link still appended
// for absentees when missing — deliberate: they should never lose the lesson)
const custom = buildAttendanceMessage(absentWarned, { status: 'غائب', lesson, settings: { msg_attendance_absent: 'غايب: {studentName} — {remainingWarnings}' } })
check('custom template honored', custom, 'غايب: سعاد علي — 2\nرابط شرح الحصة: https://v.example/x')

// Placeholder collapse: empty lesson topic must not leave dangling lines
const noTopic = buildAttendanceMessage(present, { status: 'حاضر', lesson: { ...lesson, lesson_topic: '' }, settings })
check('no dangling blank block', !noTopic.includes('\n\n\n'), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
