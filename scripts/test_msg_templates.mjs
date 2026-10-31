#!/usr/bin/env node
// Simulation of buildAttendanceMessage output for the NEW default templates.
// Mirrors interpolateAttendance + var construction from qrPdfWhatsApp.js.
const DEFAULT_PRESENT = 'أهلًا حضرتك 🌟\n{studentName} حضر حصة {group} النهارده ✅\n{sessionDetails}شكرًا لمتابعتكم.'
const DEFAULT_ABSENT = 'تيم مستر محمد البنداري يرحب بكم،\nولي أمر الطالب {studentName}،\nتم تسجيله غياب في الحصة بتاريخ {date}.\nللاستفسار عن مواعيد وأماكن التعويض برجاء التواصل على نفس الرقم.'

function interpolate(t, vars) {
  let out = String(t || '')
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v ?? ''))
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

function build({ status, studentName = 'سليم أحمد', group = 'تالتة ثانوي', examVals, homeworkText, lessonTopic, hwStatus, date = 'الخميس، ٢ أكتوبر' }) {
  const isPresent = String(status).includes('حاضر')
  const examLine = examVals && examVals.examTitle && examVals.examMaxScore
    ? `درجة الامتحان: اختبار «${examVals.examTitle}» — ${examVals.examScore} من ${examVals.examMaxScore}${examVals.examPercentage !== '' ? ` (${examVals.examPercentage}%)` : ''}` : ''
  // mirrors qrPdfWhatsApp.js: student hw status wins, else assignment text
  const HW_DONE = ['تم', 'مكتمل']
  const hwRaw = hwStatus != null ? String(hwStatus).trim() : ''
  const hwStatusLine = HW_DONE.includes(hwRaw) ? 'الواجب: تم الحل ✅'
    : hwRaw === 'ناقص' ? 'الواجب: ناقص ⚠️'
      : hwRaw === 'لم يتم' ? 'الواجب: لم يتم الحل ❌'
        : ''
  const homeworkLine = hwStatusLine || (homeworkText ? `الواجب: ${homeworkText}` : '')
  const lessonLineRaw = lessonTopic ? `موضوع الحصة: ${lessonTopic}` : ''
  const sessionDetails = [examLine, homeworkLine, lessonLineRaw].filter(Boolean).join('\n')
  const vars = {
    studentName, group, date,
    lessonLine: lessonLineRaw ? `${lessonLineRaw}\n` : '',
    homeworkLine, examLine,
    sessionDetails: sessionDetails ? `${sessionDetails}\n` : '',
  }
  return interpolate(isPresent ? DEFAULT_PRESENT : DEFAULT_ABSENT, vars)
}

console.log('── 1) حاضر + امتحان + واجب + موضوع (اليوم الكامل) ──')
console.log(build({ status: 'حاضر', examVals: { examTitle: 'تدريب ٢', examScore: 28, examMaxScore: 30, examPercentage: 93 }, homeworkText: 'حل ورقة التربيع ص ٤٥', lessonTopic: 'التفاضل والتكامل' }))
console.log('\n── 2) حاضر + واجب + موضوع (يوم من غير امتحان) ──')
console.log(build({ status: 'حاضر', homeworkText: 'حل ورقة التربيع ص ٤٥', lessonTopic: 'التفاضل والتكامل' }))
console.log('\n── 2ب) حاضر + امتحان + واجب الطالب "تم" ──')
console.log(build({ status: 'حاضر', examVals: { examTitle: 'تدريب ٣', examScore: 25, examMaxScore: 30, examPercentage: 83 }, hwStatus: 'تم' }))
console.log('\n── 2ج) حاضر + واجب الطالب "لم يتم" (مفيش نص واجب) ──')
console.log(build({ status: 'حاضر', hwStatus: 'لم يتم' }))
console.log('\n── 2د) حاضر + واجب "ناقص" + نص واجب (الحالة تتقدم على النص) ──')
console.log(build({ status: 'حاضر', hwStatus: 'ناقص', homeworkText: 'حل ورقة التربيع ص ٤٥' }))
console.log('\n── 2هـ) حاضر + واجب "لم يرصد" + نص واجب (رجوع للنص) ──')
console.log(build({ status: 'حاضر', hwStatus: 'لم يرصد', homeworkText: 'حل ورقة التربيع ص ٤٥' }))
console.log('\n── 3) حاضر (مفيش أي تفاصيل) ──')
console.log(build({ status: 'حاضر' }))
console.log('\n── 4) غايب (قالب ولي الأمر الجديد) ──')
console.log(build({ status: 'غائب', date: 'الخميس، ٢ أكتوبر' }))
console.log('\n── 5) غايب + رابط فيديو (يُضاف تلقائيًا) ──')
const absent = build({ status: 'غائب' })
console.log(absent + '\nرابط شرح الحصة: https://youtu.be/xYZ123')
