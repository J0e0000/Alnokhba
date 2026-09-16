import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError } from "@/lib/validation";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

/** POST /api/notifications/send
 *  body: { title, body, audience: "student"|"parent"|"teacher", studentId?, groupId? }
 *  Sends a custom message notification (teacher message).
 */
export async function POST(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const title = (body?.title || "").toString().trim();
  const message = (body?.body || "").toString().trim();
  const audience = (body?.audience || "student").toString();
  const studentId = (body?.studentId || "").toString().trim() || null;
  const groupId = (body?.groupId || "").toString().trim() || null;

  if (title.length < 3) return validationError("العنوان يجب أن يكون 3 أحرف على الأقل.");
  if (message.length < 3) return validationError("الرسالة يجب أن تكون 3 أحرف على الأقل.");
  if (!["student", "parent", "teacher"].includes(audience)) {
    return validationError("الجمهور غير صحيح.");
  }

  // If groupId is specified, send to all students in that group
  if (groupId) {
    const group = await db.group.findFirst({
      where: { id: groupId, teacherId: teacher.id },
      select: { id: true },
    });
    if (!group) return validationError("المجموعة غير موجودة.");
    const students = await db.student.findMany({
      where: { groupId, archived: false },
      select: { id: true },
    });
    for (const s of students) {
      await notify({
        teacherId: teacher.id,
        audience: audience as any,
        studentId: s.id,
        type: "message",
        title,
        body: message,
      });
    }
    return Response.json({ ok: true, sent: students.length });
  }

  // Single student or general
  await notify({
    teacherId: teacher.id,
    audience: audience as any,
    studentId,
    type: "message",
    title,
    body: message,
  });
  return Response.json({ ok: true, sent: 1 });
}
