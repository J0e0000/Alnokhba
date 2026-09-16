import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher, hashPassword, verifyPassword } from "@/lib/auth";
import { validationError, validatePassword } from "@/lib/validation";

export const runtime = "nodejs";

/** POST /api/auth/change-password — change the current teacher's password. */
export async function POST(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const currentPassword = (body?.currentPassword || "").toString();
  const newPassword = (body?.newPassword || "").toString();

  if (!currentPassword) return validationError("كلمة المرور الحالية مطلوبة.");
  const passCheck = validatePassword(newPassword);
  if (!passCheck.ok) return validationError(passCheck.error!);

  // Fetch the full teacher with password hash
  const fullTeacher = await db.teacher.findUnique({
    where: { id: teacher.id },
    select: { id: true, passwordHash: true },
  });
  if (!fullTeacher) return validationError("الحساب غير موجود.");

  // Verify current password
  const ok = await verifyPassword(currentPassword, fullTeacher.passwordHash);
  if (!ok) return validationError("كلمة المرور الحالية غير صحيحة.");

  // Don't allow same password
  if (currentPassword === newPassword) {
    return validationError("لا يمكن استخدام نفس كلمة المرور السابقة.");
  }

  // Update password
  const passwordHash = await hashPassword(newPassword);
  await db.teacher.update({
    where: { id: teacher.id },
    data: { passwordHash },
  });

  return Response.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح." });
}
