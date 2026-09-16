import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** PATCH /api/homework/[id] — edit homework. */
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
  const hw = await db.homework.findFirst({ where: { id, teacherId: teacher.id } });
  if (!hw) return Response.json({ ok: false, error: "الواجب غير موجود." }, { status: 404 });

  const data: any = {};
  if (typeof body?.title === "string") data.title = body.title.trim();
  if (typeof body?.description === "string") data.description = body.description.trim() || null;
  if (typeof body?.dueDate === "string") data.dueDate = body.dueDate || null;

  const updated = await db.homework.update({ where: { id }, data });
  return Response.json({ ok: true, homework: updated });
}

/** DELETE /api/homework/[id] */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;
  const hw = await db.homework.findFirst({ where: { id, teacherId: teacher.id } });
  if (!hw) return Response.json({ ok: false, error: "الواجب غير موجود." }, { status: 404 });
  await db.homework.delete({ where: { id } });
  return Response.json({ ok: true });
}

/** POST /api/homework/[id]/toggle — toggle done status for a student. */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const studentId = (body?.studentId || "").toString();
  const done = !!body?.done;
  if (!studentId) return validationError("الطالب مطلوب.");

  const hw = await db.homework.findFirst({ where: { id, teacherId: teacher.id } });
  if (!hw) return Response.json({ ok: false, error: "الواجب غير موجود." }, { status: 404 });

  const row = await db.homeworkStatus.upsert({
    where: { homeworkId_studentId: { homeworkId: id, studentId } },
    update: { done, markedBy: "teacher", updatedAt: new Date() },
    create: { homeworkId: id, studentId, done, markedBy: "teacher" },
  });
  return Response.json({ ok: true, status: row });
}
