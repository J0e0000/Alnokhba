import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validatePhone } from "@/lib/validation";

export const runtime = "nodejs";

/** PATCH /api/auth/profile — update teacher profile. */
export async function PATCH(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }

  const data: any = {};
  if (typeof body?.fullName === "string") {
    const name = body.fullName.trim();
    if (name.length < 3) return validationError("الاسم يجب أن يكون 3 أحرف على الأقل.");
    data.fullName = name;
  }
  if (typeof body?.centerName === "string") {
    data.centerName = body.centerName.trim() || null;
  }
  if (body?.phone !== undefined) {
    const phoneInput = (body.phone || "").toString().trim();
    if (phoneInput) {
      const pc = validatePhone(phoneInput);
      if (!pc.ok) return validationError(pc.error!);
      data.phone = pc.value;
    } else {
      data.phone = null;
    }
  }
  if (typeof body?.whatsappNumber === "string") {
    const waInput = body.whatsappNumber.trim();
    if (waInput) {
      // normalize: strip + and spaces, keep digits
      const normalized = waInput.replace(/[\s\-+]/g, "");
      if (!/^\d{8,15}$/.test(normalized)) {
        return validationError("رقم واتساب غير صحيح. أدخل رقماً دولياً مثل 201012345678.");
      }
      data.whatsappNumber = normalized;
    } else {
      data.whatsappNumber = null;
    }
  }
  if (typeof body?.absenceThreshold === "number") {
    if (body.absenceThreshold < 1 || body.absenceThreshold > 20) {
      return validationError("حد الإنذار يجب أن يكون بين 1 و 20.");
    }
    data.absenceThreshold = body.absenceThreshold;
  }

  const updated = await db.teacher.update({
    where: { id: teacher.id },
    data,
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      centerName: true,
      whatsappNumber: true,
      absenceThreshold: true,
    },
  });
  return Response.json({ ok: true, teacher: updated });
}
