import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError } from "@/lib/validation";
import { checkAbsenceWarning, notify } from "@/lib/notify";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** POST /api/lessons/[id]/qr-scan
 *  body: { token: string }  (the student QR token)
 *  Marks the student present via QR for this lesson.
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const lesson = await db.lesson.findFirst({
    where: { id, teacherId: teacher.id },
    select: { id: true, groupId: true, title: true, status: true, lessonDate: true },
  });
  if (!lesson) return Response.json({ ok: false, error: "الحصة غير موجودة." }, { status: 404 });
  if (lesson.status === "closed") {
    return validationError("الحصة مغلقة. لا يمكن تسجيل الحضور.");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const token = (body?.token || "").toString().trim();
  if (!token) return validationError("الرمز غير صحيح.");

  const qrToken = await db.qrToken.findUnique({
    where: { token },
    include: { student: { select: { id: true, name: true, groupId: true, teacherId: true } } },
  });
  if (!qrToken || qrToken.revokedAt) {
    return validationError("رمز QR غير صالح أو تم إلغاؤه.");
  }
  if (qrToken.teacherId !== teacher.id) {
    return validationError("هذا الرمز لا ينتمي إلى حسابك.");
  }
  if (qrToken.student.groupId !== lesson.groupId) {
    return validationError("هذا الطالب ليس من ضمن مجموعة هذه الحصة.");
  }

  const row = await db.attendance.upsert({
    where: { studentId_lessonId: { studentId: qrToken.studentId, lessonId: id } },
    update: { status: "present", method: "qr", recordedAt: new Date() },
    create: {
      teacherId: teacher.id,
      studentId: qrToken.studentId,
      lessonId: id,
      status: "present",
      method: "qr",
    },
  });

  return Response.json({
    ok: true,
    student: { id: qrToken.student.id, name: qrToken.student.name },
    attendance: row,
  });
}
