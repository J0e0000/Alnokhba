import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError } from "@/lib/validation";
import { notify, checkAbsenceWarning } from "@/lib/notify";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** GET /api/lessons/[id] — lesson detail with attendance rows. */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const lesson = await db.lesson.findFirst({
    where: { id, teacherId: teacher.id },
    include: {
      group: { select: { id: true, name: true, stage: true } },
      homework: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lesson) return Response.json({ ok: false, error: "الحصة غير موجودة." }, { status: 404 });

  // students of the group, ordered, with their attendance row for this lesson
  const students = await db.student.findMany({
    where: { groupId: lesson.groupId, archived: false },
    orderBy: { orderIdx: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      code: true,
      orderIdx: true,
    },
  });
  const attendance = await db.attendance.findMany({
    where: { lessonId: id },
    select: { id: true, studentId: true, status: true, method: true, recordedAt: true },
  });
  const attMap = new Map(attendance.map((a) => [a.studentId, a]));

  // also find exams scheduled for this group (so teacher can attach)
  const groupExams = await db.exam.findMany({
    where: { teacherId: teacher.id, groupId: lesson.groupId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, status: true, maxScore: true },
  });

  return Response.json({
    ok: true,
    lesson: {
      ...lesson,
      students: students.map((s) => ({ ...s, attendance: attMap.get(s.id) ?? null })),
      groupExams,
    },
  });
}

/** PATCH /api/lessons/[id] — edit lesson (title, topic, video, times, status). */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const lesson = await db.lesson.findFirst({ where: { id, teacherId: teacher.id } });
  if (!lesson) return Response.json({ ok: false, error: "الحصة غير موجودة." }, { status: 404 });

  const data: any = {};
  if (typeof body?.title === "string") data.title = body.title.trim();
  if (typeof body?.topic === "string") data.topic = body.topic.trim() || null;
  if (typeof body?.startTime === "string") data.startTime = body.startTime.trim() || null;
  if (typeof body?.endTime === "string") data.endTime = body.endTime.trim() || null;
  if (typeof body?.videoUrl === "string") {
    const v = body.videoUrl.trim();
    data.videoUrl = v || null;
    if (v) {
      await notify({
        teacherId: teacher.id,
        audience: "student",
        type: "video",
        title: "تمت إضافة فيديو الحصة",
        body: `تمت إضافة فيديو لحصة "${lesson.title}".`,
      });
    }
  }
  if (body?.status === "closed") {
    data.status = "closed";
    data.closedAt = new Date();
    // mark all remaining 'absent' auto-rows as final absent + check warning
    const remaining = await db.attendance.findMany({
      where: { lessonId: id, status: "absent", method: "auto" },
      select: { id: true, studentId: true },
    });
    for (const r of remaining) {
      await checkAbsenceWarning(teacher.id, r.studentId, teacher.absenceThreshold);
      await notify({
        teacherId: teacher.id,
        audience: "parent",
        studentId: r.studentId,
        type: "absence",
        title: "إشعار غياب",
        body: `تم تسجيل غياب في حصة "${lesson.title}".`,
      });
    }
  }

  const updated = await db.lesson.update({ where: { id }, data });
  return Response.json({ ok: true, lesson: updated });
}
