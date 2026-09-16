import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { validationError, generateToken } from "@/lib/validation";

export const runtime = "nodejs";

/** POST /api/auth/forgot — create a reset token (basic infrastructure). */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const email = (body?.email || "").toString().trim().toLowerCase();
  if (!email) return validationError("البريد الإلكتروني مطلوب.");

  const teacher = await db.teacher.findUnique({ where: { email } });
  // Always respond positively so we don't leak which emails exist.
  if (teacher) {
    await db.passwordReset.deleteMany({ where: { teacherId: teacher.id, used: false } });
    await db.passwordReset.create({
      data: {
        teacherId: teacher.id,
        token: generateToken(32),
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
      },
    });
    // In production: send email with link /reset?token=...
    // For now: the token is returned for dev convenience (see /api/auth/reset)
  }
  return Response.json({
    ok: true,
    message: "إذا كان البريد مسجلاً لدينا، سيصلك رابط إعادة تعيين كلمة المرور.",
  });
}
