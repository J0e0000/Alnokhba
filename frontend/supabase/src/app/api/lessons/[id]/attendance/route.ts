import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError } from "@/lib/validation";
import { checkAbsenceWarning, notify } from "@/lib/notify";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const VALID = ["present", "absent", "late", "excused"];

/** POST /api/lessons/[id]/attendance — set attendance for one or many students.
 *  body: { records: [{ studentId, status, method? }] }
 *  body: { studentId, status, method? }  (single)
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const lesson = await db.lesson.findFirst({
    where: { id, teacherId: teacher.id },
    select: { id: true, groupId: true, title: true, status: true },
  });
  if (!lesson) return Response.json({ ok: false, error: "الحصة غير موجودة." }, { status: 404 });
  if (lesson.status === "closed") {
    return validationError("الحصة مغلقة. لا يمكن تعديل الحضور بعد الإغلاق.");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }

  const records: Array<{ studentId: string; status: string; method?: string }> = body?.records
    ? body.records
    : [{ studentId: body?.studentId, status: body?.status, method: body?.method }];

  if (!Array.isArray(records) || records.length === 0) {
    return validationError("لا توجد سجلات حضور.");
  }

  // validate each record
  for (const r of records) {
    if (!r.studentId || !VALID.includes(r.status)) {
      return validationError("بيانات الحضور غير صحيحة.");
    }
    // verify student belongs to teacher and lesson's group
    const student = await db.student.findFirst({
      where: { id: r.studentId, teacherId: teacher.id },
      select: { id: true, groupId: true, name: true },
    });
    if (!student) return validationError("طالب غير موجود.");
  }

  // upsert attendance rows
  const results = [];
  for (const r of records) {
    const method = r.method || "manual";
    const row = await db.attendance.upsert({
      where: { studentId_lessonId: { studentId: r.studentId, lessonId: id } },
      update: { status: r.status, method, recordedAt: new Date() },
      create: {
        teacherId: teacher.id,
        studentId: r.studentId,
        lessonId: id,
        status: r.status,
        method,
      },
    });
    results.push(row);

    // if marked absent, recheck warning threshold
    if (r.status === "absent") {
      await checkAbsenceWarning(teacher.id, r.studentId, teacher.absenceThreshold);
    }
  }

  return Response.json({ ok: true, count: results.length });
}
