import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/auth/me — current teacher. */
export async function GET() {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, teacher: null }, { status: 401 });
  // counts for quick dashboard badges
  const [groups, students, lessonsToday, exams, notifications] = await Promise.all([
    db.group.count({ where: { teacherId: teacher.id, archived: false } }),
    db.student.count({ where: { teacherId: teacher.id, archived: false } }),
    db.lesson.count({ where: { teacherId: teacher.id } }),
    db.exam.count({ where: { teacherId: teacher.id } }),
    db.notification.count({ where: { teacherId: teacher.id, audience: "teacher", read: false } }),
  ]);
  return Response.json({
    ok: true,
    teacher,
    counts: { groups, students, lessonsToday, exams, notifications },
  });
}
