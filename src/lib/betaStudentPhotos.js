const PREFIX = 'nokhba_beta_student_photo:'

export function getBetaStudentPhoto(student) {
  if (!student?.id) return student?.photo_url || ''
  try { return localStorage.getItem(`${PREFIX}${student.id}`) || student.photo_url || '' } catch { return student.photo_url || '' }
}

export function saveBetaStudentPhoto(studentId, dataUrl) {
  if (!studentId || !dataUrl) return false
  try { localStorage.setItem(`${PREFIX}${studentId}`, dataUrl); return true } catch { return false }
}

export function removeBetaStudentPhoto(studentId) {
  try { localStorage.removeItem(`${PREFIX}${studentId}`) } catch {}
}

export function validateBetaStudentPhoto(file) {
  if (!file) return { ok: false, message: 'لم يتم اختيار صورة.' }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { ok: false, message: 'اختر صورة JPG أو PNG أو WebP فقط.' }
  if (file.size > 2 * 1024 * 1024) return { ok: false, message: 'حجم الصورة يجب ألا يتجاوز 2 ميجابايت.' }
  return { ok: true }
}
