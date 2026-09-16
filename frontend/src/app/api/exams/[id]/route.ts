import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateScore } from "@/lib/validation";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** GET /api/exams/[id] — exam detail with all student results. */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const exam = await db.exam.findFirst({
    where: { id, teacherId: teacher.id },
    include: { group: { select: { id: true, name: true, stage: true } } },
  });
  if (!exam) return Response.json({ ok: false, error: "الامتحان غير موجود." }, { status: 404 });

  const results = await db.examResult.findMany({
    where: { examId: id },
    include: {
      student: { select: { id: true, name: true, code: true, orderIdx: true } },
    },
    orderBy: { student: { orderIdx: "asc" } },
  });

  return Response.json({
    ok: true,
    exam: {
      ...exam,
      questions: JSON.parse(exam.questionsJson || "[]"),
      results: results.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: r.student.name,
        studentCode: r.student.code,
        score: r.score,
        status: r.status,
        percentage: exam.maxScore ? Math.round((r.score / exam.maxScore) * 100) : 0,
        note: r.note,
        gradedAt: r.gradedAt,
      })),
    },
  });
}

/** PATCH /api/exams/[id] — edit exam fields or publish. */
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
  const exam = await db.exam.findFirst({ where: { id, teacherId: teacher.id } });
  if (!exam) return Response.json({ ok: false, error: "الامتحان غير موجود." }, { status: 404 });

  const data: any = {};
  if (typeof body?.title === "string") {
    if (body.title.trim().length < 3) return validationError("العنوان قصير جدًا.");
    data.title = body.title.trim();
  }
  if (typeof body?.description === "string") data.description = body.description.trim() || null;
  if (body?.maxScore !== undefined) {
    const m = Number(body.maxScore);
    if (!Number.isFinite(m) || m <= 0) return validationError("الدرجة العظمى غير صحيحة.");
    data.maxScore = m;
  }
  if (body?.passScore !== undefined) {
    const p = Number(body.passScore);
    if (body.passScore !== null && (!Number.isFinite(p) || p < 0 || p > (data.maxScore ?? exam.maxScore))) {
      return validationError("درجة النجاح غير صحيحة.");
    }
    data.passScore = body.passScore === null ? null : p;
  }
  if (Array.isArray(body?.questions)) data.questionsJson = JSON.stringify(body.questions);
  if (body?.status === "published" && exam.status !== "published") {
    data.status = "published";
    data.publishedAt = new Date();
    await notify({
      teacherId: teacher.id,
      audience: "student",
      type: "exam",
      title: "تم نشر امتحان",
      body: `تم نشر امتحان "${exam.title}".`,
    });
  }
  if (body?.status === "closed") {
    data.status = "closed";
  }

  const updated = await db.exam.update({ where: { id }, data });
  return Response.json({ ok: true, exam: updated });
}

/** DELETE /api/exams/[id] — delete exam. */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;
  const exam = await db.exam.findFirst({ where: { id, teacherId: teacher.id } });
  if (!exam) return Response.json({ ok: false, error: "الامتحان غير موجود." }, { status: 404 });
  await db.exam.delete({ where: { id } });
  return Response.json({ ok: true });
}
