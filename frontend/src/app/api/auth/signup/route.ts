import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, signSession, buildSessionCookieHeader } from "@/lib/auth";
import { validateEmail, validatePassword, validationError } from "@/lib/validation";

export const runtime = "nodejs";

/** POST /api/auth/signup — register a new teacher (trial). */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const fullName = (body?.fullName || "").toString().trim();
  const email = (body?.email || "").toString().trim().toLowerCase();
  const password = (body?.password || "").toString();
  const centerName = (body?.centerName || "").toString().trim() || null;
  const phone = (body?.phone || "").toString().trim() || null;

  if (fullName.length < 3) return validationError("الاسم يجب أن يكون 3 أحرف على الأقل.");
  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) return validationError(emailCheck.error!);
  const passCheck = validatePassword(password);
  if (!passCheck.ok) return validationError(passCheck.error!);

  const existing = await db.teacher.findUnique({ where: { email } });
  if (existing) return validationError("هذا البريد الإلكتروني مسجّل بالفعل.");

  const passwordHash = await hashPassword(password);
  const teacher = await db.teacher.create({
    data: {
      email,
      passwordHash,
      fullName,
      centerName,
      phone,
      subscriptionStatus: "trial",
      subscriptionExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 5),
    },
    select: { id: true, email: true, fullName: true },
  });

  const token = await signSession({ teacherId: teacher.id, email: teacher.email });
  const res = Response.json({ ok: true, teacher });
  res.headers.set("Set-Cookie", buildSessionCookieHeader(token));
  return res;
}
