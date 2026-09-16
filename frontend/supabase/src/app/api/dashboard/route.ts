import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { todayStr } from "@/lib/arabic";

export const runtime = "nodejs";

/** GET /api/dashboard — today's lessons + quick stats. */
export async function GET() {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const today = todayStr();

  const [groups, students, todaysLessons, exams, unreadNotifs] = await Promise.all([
    db.group.count({ where: { teacherId: teacher.id, archived: false } }),
    db.student.count({ where: { teacherId: teacher.id, archived: false } }),
    db.lesson.findMany({
      where: { teacherId: teacher.id, lessonDate: today },
      orderBy: { startTime: "asc" },
      include: {
        group: { select: { id: true, name: true, stage: true } },
      },
    }),
    db.exam.count({ where: { teacherId: teacher.id } }),
    db.notification.count({ where: { teacherId: teacher.id, audience: "teacher", read: false } }),
  ]);

  // count students at/over threshold — simple queries, no relation filter
  const allStudentIds = await db.student.findMany({
    where: { teacherId: teacher.id, archived: false },
    select: { id: true },
  });
  let warningsCount = 0;
  for (const s of allStudentIds) {
    const absentCount = await db.attendance.count({
      where: { studentId: s.id, status: "absent" },
    });
    if (absentCount >= teacher.absenceThreshold) warningsCount++;
  }

  // attach present/absent counts for today's lessons
  const lessonsWithStats = [];
  for (const l of todaysLessons) {
    const [present, absent, studentCount] = await Promise.all([
      db.attendance.count({ where: { lessonId: l.id, status: "present" } }),
      db.attendance.count({ where: { lessonId: l.id, status: "absent" } }),
      db.student.count({ where: { groupId: l.groupId, archived: false } }),
    ]);
    lessonsWithStats.push({
      id: l.id,
      title: l.title,
      topic: l.topic,
      startTime: l.startTime,
      status: l.status,
      group: l.group,
      studentCount,
      presentCount: present,
      absentCount: absent,
    });
  }

  // top at-risk students for the "needs attention" section
  const atRiskStudents: Array<{ id: string; name: string; absent: number; group: { name: string } | null }> = [];
  for (const s of allStudentIds) {
    const absentCount = await db.attendance.count({
      where: { studentId: s.id, status: "absent" },
    });
    if (absentCount >= teacher.absenceThreshold) {
      const student = await db.student.findUnique({
        where: { id: s.id },
        select: { id: true, name: true, group: { select: { name: true } } },
      });
      if (student) atRiskStudents.push({ ...student, absent: absentCount, group: student.group });
    }
  }
  atRiskStudents.sort((a, b) => b.absent - a.absent);

  return Response.json({
    ok: true,
    teacher: {
      id: teacher.id,
      fullName: teacher.fullName,
      centerName: teacher.centerName,
      absenceThreshold: teacher.absenceThreshold,
    },
    today,
    stats: {
      groups,
      students,
      todaysLessons: todaysLessons.length,
      exams,
      warnings: warningsCount,
      unreadNotifs,
    },
    todaysLessons: lessonsWithStats,
    atRiskStudents: atRiskStudents.slice(0, 5),
  });
}
