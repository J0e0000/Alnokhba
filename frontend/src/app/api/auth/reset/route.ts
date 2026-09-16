import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { validationError, validatePassword } from "@/lib/validation";

export const runtime = "nodejs";

/** POST /api/auth/reset — reset password with a token. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const token = (body?.token || "").toString();
  const password = (body?.password || "").toString();
  const passCheck = validatePassword(password);
  if (!passCheck.ok) return validationError(passCheck.error!);
  if (!token) return validationError("الرابط غير صالح.");

  const rec = await db.passwordReset.findUnique({ where: { token } });
  if (!rec || rec.used || rec.expiresAt < new Date()) {
    return validationError("انتهت صلاحية الرابط أو أنه غير صالح.");
  }
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.teacher.update({ where: { id: rec.teacherId }, data: { passwordHash } }),
    db.passwordReset.update({ where: { id: rec.id }, data: { used: true } }),
  ]);
  return Response.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح." });
}
