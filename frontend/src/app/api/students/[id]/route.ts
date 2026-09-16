import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import {
  validationError,
  validatePhone,
  validateStage,
  normalizePhone,
} from "@/lib/validation";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** GET /api/students/[id] — student detail with full history. */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const student = await db.student.findFirst({
    where: { id, teacherId: teacher.id },
    include: {
      group: { select: { id: true, name: true, stage: true } },
      attendance: {
        orderBy: { recordedAt: "desc" },
        take: 60,
        include: { lesson: { select: { id: true, title: true, lessonDate: true } } },
      },
      results: {
        orderBy: { createdAt: "desc" },
        include: { exam: { select: { id: true, title: true, maxScore: true, status: true } } },
      },
      hwStatus: {
        orderBy: { updatedAt: "desc" },
        include: { homework: { select: { id: true, title: true, dueDate: true } } },
      },
      qrTokens: { where: { revokedAt: null }, take: 1 },
    },
  });
  if (!student) return Response.json({ ok: false, error: "الطالب غير موجود." }, { status: 404 });

  const present = student.attendance.filter((a) => a.status === "present").length;
  const absent = student.attendance.filter((a) => a.status === "absent").length;
  const total = student.attendance.length;
  const rate = total ? Math.round((present / total) * 100) : 0;
  const warn = absent >= teacher.absenceThreshold;

  return Response.json({
    ok: true,
    student: {
      ...student,
      attendanceSummary: { present, absent, total, rate, warn, threshold: teacher.absenceThreshold },
      qrToken: student.qrTokens[0]?.token ?? null,
    },
  });
}

/** PATCH /api/students/[id] — edit a student. */
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

  const student = await db.student.findFirst({ where: { id, teacherId: teacher.id } });
  if (!student) return Response.json({ ok: false, error: "الطالب غير موجود." }, { status: 404 });

  const data: any = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 3) return validationError("اسم الطالب يجب أن يكون 3 أحرف على الأقل.");
    data.name = name;
  }
  if (body?.phone !== undefined) {
    const phoneInput = (body.phone || "").toString().trim();
    if (phoneInput) {
      const phoneCheck = validatePhone(phoneInput);
      if (!phoneCheck.ok) return validationError(phoneCheck.error!);
      // duplicate check against other students
      const dup = await db.student.findFirst({
        where: { teacherId: teacher.id, phone: phoneCheck.value, NOT: { id } },
      });
      if (dup) return validationError("رقم الهاتف مستخدم لطالب آخر.");
      data.phone = phoneCheck.value;
    } else {
      data.phone = null;
    }
  }
  if (typeof body?.stage === "string") {
    if (body.stage) {
      const stageCheck = validateStage(body.stage);
      if (!stageCheck.ok) return validationError(stageCheck.error!);
      data.stage = body.stage;
    } else {
      data.stage = null;
    }
  }
  if (body?.groupId !== undefined) {
    const groupId = (body.groupId || "").toString().trim() || null;
    if (groupId) {
      const group = await db.group.findFirst({ where: { id: groupId, teacherId: teacher.id } });
      if (!group) return validationError("المجموعة المحددة غير موجودة.");
      data.groupId = groupId;
    } else {
      data.groupId = null;
    }
  }
  if (typeof body?.code === "string") {
    data.code = body.code.trim() || null;
  }
  if (typeof body?.orderIdx === "number") {
    data.orderIdx = body.orderIdx;
  }
  if (typeof body?.archived === "boolean") {
    data.archived = body.archived;
  }

  const updated = await db.student.update({ where: { id }, data });
  return Response.json({ ok: true, student: updated });
}

/** DELETE /api/students/[id] — archive by default, or hard delete with ?hard=1. */
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const student = await db.student.findFirst({ where: { id, teacherId: teacher.id } });
  if (!student) return Response.json({ ok: false, error: "الطالب غير موجود." }, { status: 404 });

  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";
  if (hard) {
    await db.student.delete({ where: { id } });
  } else {
    await db.student.update({ where: { id }, data: { archived: true } });
  }
  return Response.json({ ok: true });
}


