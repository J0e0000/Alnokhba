import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, generateToken } from "@/lib/validation";
import { ensureQrToken } from "@/lib/notify";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** GET /api/students/[id]/qr — get or create the student's active QR token. */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const student = await db.student.findFirst({
    where: { id, teacherId: teacher.id },
    select: { id: true, name: true },
  });
  if (!student) return Response.json({ ok: false, error: "الطالب غير موجود." }, { status: 404 });

  const token = await ensureQrToken(teacher.id, id, () => generateToken(24));
  return Response.json({ ok: true, token: token.token, student });
}

/** POST /api/students/[id]/qr — regenerate (revoke old, create new). */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;

  const student = await db.student.findFirst({
    where: { id, teacherId: teacher.id },
    select: { id: true, name: true },
  });
  if (!student) return Response.json({ ok: false, error: "الطالب غير موجود." }, { status: 404 });

  await db.qrToken.updateMany({
    where: { studentId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const token = await db.qrToken.create({
    data: { teacherId: teacher.id, studentId: id, token: generateToken(24) },
  });
  return Response.json({ ok: true, token: token.token, student });
}
