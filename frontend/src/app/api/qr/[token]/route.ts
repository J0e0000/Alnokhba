import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ATTENDANCE_LABEL, todayStr, attendanceSummary, warningStatus } from "@/lib/arabic";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

/** GET /api/qr/[token] — public student/parent portal data (token-gated, no auth).
 *  Backward compatible: if the token is a valid student id (cuid), accept it too.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { token } = await ctx.params;

  // 1) Try by token (primary path)
  let qrToken = await db.qrToken.findUnique({
    where: { token },
    include: { student: true, teacher: { select: { fullName: true, centerName: true, whatsappNumber: true, absenceThreshold: true } } },
  });

  // 2) Backward-compat: if not found and token looks like a cuid, try by studentId
  if (!qrToken || qrToken.revokedAt) {
    const byStudent = await db.student.findUnique({
      where: { id: token },
      include: { qrTokens: { where: { revokedAt: null }, take: 1 } },
    });
    if (byStudent && byStudent.qrTokens.length === 0) {
      // auto-mint a token for this legacy student so future visits are stable
      const newToken = await db.qrToken.create({
        data: { teacherId: byStudent.teacherId, studentId: byStudent.id, token: token },
      });
      qrToken = await db.qrToken.findUnique({
        where: { id: newToken.id },
        include: { student: true, teacher: { select: { fullName: true, centerName: true, whatsappNumber: true, absenceThreshold: true } } },
      });
    }
  }

  if (!qrToken || qrToken.revokedAt || !qrToken.student) {
    return Response.json(
      { ok: false, error: "الرابط غير صالح أو تم إبطاله." },
      { status: 404 }
    );
  }

  const student = qrToken.student;
  const teacher = qrToken.teacher!;
  const threshold = teacher.absenceThreshold ?? 3;

  // attendance
  const attendance = await db.attendance.findMany({
    where: { studentId: student.id },
    orderBy: { recordedAt: "desc" },
    take: 60,
    include: { lesson: { select: { id: true, title: true, lessonDate: true, topic: true } } },
  });
  const summary = attendanceSummary(attendance);

  // today's lesson
  const today = todayStr();
  const todaysLesson = await db.lesson.findFirst({
    where: { teacherId: student.teacherId, groupId: student.groupId ?? undefined, lessonDate: today },
    include: { group: { select: { name: true } } },
  });

  // homework (group's homework)
  const homework: any[] = [];
  if (student.groupId) {
    const hw = await db.homework.findMany({
      where: { groupId: student.groupId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        status: { where: { studentId: student.id }, take: 1 },
      },
    });
    for (const h of hw) {
      homework.push({
        id: h.id,
        title: h.title,
        description: h.description,
        dueDate: h.dueDate,
        done: h.status[0]?.done ?? false,
      });
    }
  }

  // exam results
  const results = await db.examResult.findMany({
    where: { studentId: student.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { exam: { select: { id: true, title: true, maxScore: true, status: true } } },
  });

  // notifications for this student (or public to all students of this teacher)
  const notifications = await db.notification.findMany({
    where: {
      teacherId: student.teacherId,
      audience: { in: ["student", "parent"] },
      OR: [{ studentId: null }, { studentId: student.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, type: true, title: true, body: true, createdAt: true },
  });

  // video links from recent lessons
  const recentLessons = await db.lesson.findMany({
    where: { teacherId: student.teacherId, groupId: student.groupId ?? undefined, videoUrl: { not: null } },
    orderBy: { lessonDate: "desc" },
    take: 5,
    select: { id: true, title: true, lessonDate: true, videoUrl: true, topic: true },
  });

  return Response.json({
    ok: true,
    student: {
      id: student.id,
      name: student.name,
      stage: student.stage,
      code: student.code,
      groupName: student.groupId,
    },
    teacher: {
      fullName: teacher.fullName,
      centerName: teacher.centerName,
      whatsappNumber: teacher.whatsappNumber,
    },
    attendance: {
      ...summary,
      threshold,
      warn: summary.absent >= threshold,
      warning: warningStatus(summary.absent, threshold),
      recent: attendance.slice(0, 10).map((a) => ({
        id: a.id,
        status: a.status,
        label: ATTENDANCE_LABEL[a.status],
        lessonTitle: a.lesson?.title,
        lessonDate: a.lesson?.lessonDate,
        method: a.method,
        recordedAt: a.recordedAt,
      })),
    },
    todaysLesson: todaysLesson
      ? {
          id: todaysLesson.id,
          title: todaysLesson.title,
          topic: todaysLesson.topic,
          startTime: todaysLesson.startTime,
          status: todaysLesson.status,
          groupName: todaysLesson.group?.name,
          videoUrl: todaysLesson.videoUrl,
        }
      : null,
    homework,
    examResults: results.map((r) => ({
      id: r.id,
      examTitle: r.exam.title,
      score: r.score,
      maxScore: r.exam.maxScore,
      percentage: r.exam.maxScore ? Math.round((r.score / r.exam.maxScore) * 100) : 0,
      status: r.status,
      gradedAt: r.gradedAt,
    })),
    notifications,
    videos: recentLessons.map((l) => ({
      id: l.id,
      title: l.title,
      lessonDate: l.lessonDate,
      url: l.videoUrl,
      topic: l.topic,
    })),
  });
}
