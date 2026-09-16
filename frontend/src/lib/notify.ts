import { db } from "./db"

/** Create a notification scoped to a teacher. audience controls who sees it. */
export async function notify(opts: {
  teacherId: string
  audience?: "teacher" | "student" | "parent"
  studentId?: string
  type: "absence" | "warning" | "homework" | "video" | "exam" | "result" | "lesson" | "message"
  title: string
  body: string
}) {
  return db.notification.create({
    data: {
      teacherId: opts.teacherId,
      audience: opts.audience ?? "teacher",
      studentId: opts.studentId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
    },
  })
}

/** Recompute a student's absence count and emit a warning notification if crossed. */
export async function checkAbsenceWarning(teacherId: string, studentId: string, threshold: number) {
  const absentCount = await db.attendance.count({
    where: { teacherId, studentId, status: "absent" },
  })
  const warn = absentCount >= threshold
  if (warn && absentCount === threshold) {
    // only fire once when crossing the threshold
    const existing = await db.notification.findFirst({
      where: { teacherId, studentId, type: "warning" },
    })
    if (!existing) {
      const student = await db.student.findUnique({ where: { id: studentId }, select: { name: true } })
      await notify({
        teacherId,
        audience: "teacher",
        studentId,
        type: "warning",
        title: "إنذار غياب",
        body: `الطالب ${student?.name ?? ""} وصل إلى ${absentCount} حالات غياب (حد الإنذار ${threshold}).`,
      })
    }
  }
  return { absentCount, warn }
}

/** Ensure a student has exactly one active QR token; create if missing. */
export async function ensureQrToken(teacherId: string, studentId: string, generateToken: () => string) {
  const existing = await db.qrToken.findFirst({
    where: { teacherId, studentId, revokedAt: null },
  })
  if (existing) return existing
  return db.qrToken.create({
    data: {
      teacherId,
      studentId,
      token: generateToken(),
    },
  })
}
