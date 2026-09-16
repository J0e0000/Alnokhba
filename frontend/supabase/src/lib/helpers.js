// دوال مساعدة مشتركة — نفس منطق النسخة الأصلية بالظبط

export const STAGE_CATEGORIES = ['ابتدائي', 'إعدادي', 'ثانوي']

export const GRADES_BY_STAGE = {
  'ابتدائي': ['الأول الابتدائي', 'الثاني الابتدائي'],
  'إعدادي': ['الأول الإعدادي', 'الثاني الإعدادي', 'الثالث الإعدادي'],
  'ثانوي': ['الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'],
}

export const CORE_GRADE_OPTIONS = Object.values(GRADES_BY_STAGE).flat()

export function generateStudentCode() {
  return 'F-' + Math.floor(10000 + Math.random() * 90000)
}

export function normalizeArabicDigits(value) {
  return String(value || '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
}

/**
 * Normalize an Egyptian mobile number to WhatsApp international digits.
 * Valid output is exactly 12 digits: 20 + Egyptian mobile number.
 * Examples: 01012345678 -> 201012345678; +201012345678 -> 201012345678.
 */
export function normalizeEgyptianPhone(phone) {
  let raw = normalizeArabicDigits(phone).trim().replace(/\D/g, '')
  if (raw.startsWith('00')) raw = raw.slice(2)
  if (/^201[0125]\d{8}$/.test(raw)) return raw
  if (/^01[0125]\d{8}$/.test(raw)) return `20${raw.slice(1)}`
  return ''
}

export function sanitizePhone(phone) {
  return normalizeEgyptianPhone(phone)
}

export function getWhatsAppPhoneDigits(phone) {
  return normalizeEgyptianPhone(phone)
}

export function formatWhatsAppPhone(phone) {
  const normalized = normalizeEgyptianPhone(phone)
  return normalized ? `+${normalized}` : ''
}

export function isValidPhone(phone) {
  return Boolean(normalizeEgyptianPhone(phone))
}

export function getStudentRank(points, ranks) {
  if (!ranks || ranks.length === 0) return ''
  let title = ranks[0].title
  for (const r of ranks) { if (points >= r.min) title = r.title }
  return title
}

export function getStudentRankPosition(studentId, allStudents) {
  const sorted = [...allStudents].sort((a, b) => b.points - a.points)
  const index = sorted.findIndex((s) => s.id === studentId)
  return index !== -1 ? index + 1 : '-'
}

// طالب فيه تراجع أكاديمي: آخر امتحانين والنسبة نزلت 15% أو أكتر
export function checkAcademicWarning(exams) {
  if (!exams || exams.length < 2) return false
  const last = exams[exams.length - 1]
  const prev = exams[exams.length - 2]
  const lastSections = Object.keys(last.section_scores || {}).length
  const prevSections = Object.keys(prev.section_scores || {}).length
  if (lastSections === 0 || prevSections === 0) return false
  const lastPct = (last.total_score / (last.max_score_per_section * lastSections)) * 100
  const prevPct = (prev.total_score / (prev.max_score_per_section * prevSections)) * 100
  return (prevPct - lastPct) >= 15
}

export function parseTemplate(templateStr, student, ranks) {
  return (templateStr || '')
    .replace(/{studentName}/g, student.name)
    .replace(/{rank}/g, getStudentRank(student.points, ranks))
    .replace(/{stage}/g, student.stage || '')
    .replace(/{group}/g, student.group_name || '')
}

let reusableWhatsAppWindow = null

export function sendWhatsApp(phone, message) {
  if (!phone || !message) return false
  if (!isValidPhone(phone)) return false
  const cleanPhone = getWhatsAppPhoneDigits(phone)
  if (!cleanPhone) return false
  const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`
  try {
    // Keep the dashboard mounted: only the dedicated named popup may navigate.
    reusableWhatsAppWindow = window.open(url, 'nokhba_whatsapp')
    if (!reusableWhatsAppWindow || reusableWhatsAppWindow.closed) return false
    reusableWhatsAppWindow.focus?.()
    return true
  } catch (error) {
    console.warn('[WhatsApp] popup navigation failed', error)
    reusableWhatsAppWindow = null
    return false
  }
}

export function closeReusableWhatsAppWindow() {
  try { reusableWhatsAppWindow?.close?.() } catch { /* ignored */ }
  reusableWhatsAppWindow = null
}
