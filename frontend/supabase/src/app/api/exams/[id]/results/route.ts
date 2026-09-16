import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateScore } from "@/lib/validation";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** PUT /api/exams/[id]/results
 *  body: { results: [{ studentId, score, status?, note? }] }
 *  Validates each score against the exam max and upserts.
 */
export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const exam = await db.exam.findFirst({
    where: { id, teacherId: teacher.id },
    select: { id: true, maxScore: true, title: true, groupId: true },
  });
  if (!exam) return Response.json({ ok: false, error: "الامتحان غير موجود." }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const results: Array<{ studentId: string; score: number; status?: string; note?: string }> =
    body?.results ?? [];
  if (!Array.isArray(results) || results.length === 0) {
    return validationError("لا توجد نتائج للحفظ.");
  }

  // validate all scores first (fail fast, no partial writes)
  for (const r of results) {
    const sc = validateScore(Number(r.score), exam.maxScore);
    if (!sc.ok) return validationError(sc.error!);
    // verify student belongs to this teacher
    const s = await db.student.findFirst({
      where: { id: r.studentId, teacherId: teacher.id },
      select: { id: true, name: true },
    });
    if (!s) return validationError("طالب غير موجود.");
  }

  // upsert all results
  for (const r of results) {
    const score = Number(r.score);
    const status = r.status ?? (score >= 0 ? "graded" : "pending");
    await db.examResult.upsert({
      where: { examId_studentId: { examId: id, studentId: r.studentId } },
      update: {
        score,
        status,
        note: r.note ?? null,
        gradedAt: status === "graded" ? new Date() : null,
      },
      create: {
        teacherId: teacher.id,
        examId: id,
        studentId: r.studentId,
        score,
        status,
        note: r.note ?? null,
        gradedAt: status === "graded" ? new Date() : null,
      },
    });
  }

  // notify students/parents that results are available
  if (results.some((r) => r.status === "graded" || !r.status)) {
    await notify({
      teacherId: teacher.id,
      audience: "parent",
      type: "result",
      title: "نتيجة امتحان متاحة",
      body: `تم رصد درجات امتحان "${exam.title}".`,
    });
  }

  return Response.json({ ok: true, count: results.length });
}
