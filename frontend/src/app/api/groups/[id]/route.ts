import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateStage } from "@/lib/validation";
import { WEEKDAY_NAMES, parseScheduleDays } from "@/lib/arabic";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** GET /api/groups/[id] — group detail with students, lessons, exams. */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const group = await db.group.findFirst({
    where: { id, teacherId: teacher.id },
    include: {
      students: {
        where: { archived: false },
        orderBy: { orderIdx: "asc" },
        select: {
          id: true,
          name: true,
          phone: true,
          stage: true,
          code: true,
          orderIdx: true,
          groupId: true,
        },
      },
      lessons: { orderBy: { lessonDate: "desc" }, take: 30 },
      exams: { orderBy: { createdAt: "desc" }, take: 20 },
      homework: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!group) return Response.json({ ok: false, error: "المجموعة غير موجودة." }, { status: 404 });

  const studentsWithStats = await Promise.all(
    group.students.map(async (s) => {
      const attendance = await db.attendance.findMany({
        where: { studentId: s.id },
        select: { status: true, lessonId: true },
      });
      const present = attendance.filter((a) => a.status === "present").length;
      const absent = attendance.filter((a) => a.status === "absent").length;
      const total = attendance.length;
      const rate = total ? Math.round((present / total) * 100) : 0;
      const warn = absent >= teacher.absenceThreshold;
      return { ...s, attendance: { present, absent, total, rate, warn } };
    })
  );

  return Response.json({
    ok: true,
    group: {
      id: group.id,
      name: group.name,
      stage: group.stage,
      scheduleDays: parseScheduleDays(group.scheduleDays),
      scheduleTime: group.scheduleTime,
      archived: group.archived,
      createdAt: group.createdAt,
      students: studentsWithStats,
      lessons: group.lessons,
      exams: group.exams,
      homework: group.homework,
    },
  });
}

/** PATCH /api/groups/[id] — edit a group. */
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

  const group = await db.group.findFirst({ where: { id, teacherId: teacher.id } });
  if (!group) return Response.json({ ok: false, error: "المجموعة غير موجودة." }, { status: 404 });

  const data: any = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 2) return validationError("اسم المجموعة يجب أن يكون حرفين على الأقل.");
    const dup = await db.group.findFirst({
      where: { teacherId: teacher.id, name, NOT: { id } },
    });
    if (dup) return validationError("يوجد مجموعة بنفس الاسم بالفعل.");
    data.name = name;
  }
  if (typeof body?.stage === "string") {
    const stageCheck = validateStage(body.stage);
    if (!stageCheck.ok) return validationError(stageCheck.error!);
    data.stage = body.stage;
  }
  if (Array.isArray(body?.scheduleDays)) {
    const days = body.scheduleDays.filter((n: any) => typeof n === "number" && n >= 0 && n <= 6);
    data.scheduleDays = JSON.stringify(days);
  }
  if (typeof body?.scheduleTime === "string") {
    data.scheduleTime = body.scheduleTime.trim() || null;
  }
  if (typeof body?.archived === "boolean") {
    data.archived = body.archived;
  }

  const updated = await db.group.update({ where: { id }, data });
  return Response.json({ ok: true, group: updated });
}

/** DELETE /api/groups/[id] — archive (soft delete) by default, or hard delete with ?hard=1. */
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const group = await db.group.findFirst({ where: { id, teacherId: teacher.id } });
  if (!group) return Response.json({ ok: false, error: "المجموعة غير موجودة." }, { status: 404 });

  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";

  if (hard) {
    await db.group.delete({ where: { id } });
  } else {
    await db.group.update({ where: { id }, data: { archived: true } });
  }
  return Response.json({ ok: true });
}


