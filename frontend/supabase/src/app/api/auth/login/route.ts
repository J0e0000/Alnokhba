import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, signSession, buildSessionCookieHeader } from "@/lib/auth";
import { validateEmail, validationError } from "@/lib/validation";

export const runtime = "nodejs";

/** POST /api/auth/login — credentials login. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const email = (body?.email || "").toString().trim().toLowerCase();
  const password = (body?.password || "").toString();
  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) return validationError(emailCheck.error!);
  if (!password) return validationError("كلمة المرور مطلوبة.");

  const teacher = await db.teacher.findUnique({ where: { email } });
  if (!teacher) return validationError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  const ok = await verifyPassword(password, teacher.passwordHash);
  if (!ok) return validationError("البريد الإلكتروني أو كلمة المرور غير صحيحة.");

  const token = await signSession({ teacherId: teacher.id, email: teacher.email });
  const res = Response.json({
    ok: true,
    teacher: {
      id: teacher.id,
      email: teacher.email,
      fullName: teacher.fullName,
      centerName: teacher.centerName,
    },
  });
  res.headers.set("Set-Cookie", buildSessionCookieHeader(token));
  return res;
}
