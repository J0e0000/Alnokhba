import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import {
  validationError,
  validatePhone,
  validateStage,
  normalizePhone,
  generateToken,
} from "@/lib/validation";
import { ensureQrToken } from "@/lib/notify";

export const runtime = "nodejs";

/** GET /api/students — list students (search/filter by group/stage/warning). */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const groupId = url.searchParams.get("groupId") || "";
  const stage = url.searchParams.get("stage") || "";
  const warn = url.searchParams.get("warn"); // "1" filter warning only
  const includeArchived = url.searchParams.get("archived") === "1";

  const where: any = { teacherId: teacher.id };
  if (!includeArchived) where.archived = false;
  if (groupId && groupId !== "all") where.groupId = groupId;
  if (stage && stage !== "all") where.stage = stage;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { code: { contains: search } },
    ];
  }

  const students = await db.student.findMany({
    where,
    orderBy: [{ orderIdx: "asc" }, { createdAt: "desc" }],
    include: { group: { select: { id: true, name: true, stage: true } } },
    take: 500,
  });

  // attach attendance summary + warning flag
  const result = await Promise.all(
    students.map(async (s) => {
      const attendance = await db.attendance.findMany({
        where: { studentId: s.id },
        select: { status: true },
      });
      const present = attendance.filter((a) => a.status === "present").length;
      const absent = attendance.filter((a) => a.status === "absent").length;
      const total = attendance.length;
      const rate = total ? Math.round((present / total) * 100) : 0;
      const warnFlag = absent >= teacher.absenceThreshold;
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        stage: s.stage,
        code: s.code,
        orderIdx: s.orderIdx,
        archived: s.archived,
        group: s.group,
        attendance: { present, absent, total, rate, warn: warnFlag },
      };
    })
  );

  const filtered = warn === "1" ? result.filter((s) => s.attendance.warn) : result;
  return Response.json({ ok: true, students: filtered });
}

/** POST /api/students — create a student (with smart validation). */
export async function POST(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const name = (body?.name || "").toString().trim();
  const phoneInput = (body?.phone || "").toString().trim();
  const stage = (body?.stage || "").toString().trim();
  const groupId = (body?.groupId || "").toString().trim() || null;
  const code = (body?.code || "").toString().trim() || null;

  if (name.length < 3) return validationError("اسم الطالب يجب أن يكون 3 أحرف على الأقل.");

  let phone: string | null = null;
  if (phoneInput) {
    const phoneCheck = validatePhone(phoneInput);
    if (!phoneCheck.ok) return validationError(phoneCheck.error!);
    phone = phoneCheck.value;
  }

  let stageValue: string | null = null;
  if (stage) {
    const stageCheck = validateStage(stage);
    if (!stageCheck.ok) return validationError(stageCheck.error!);
    stageValue = stage;
  }

  // validate group belongs to teacher
  if (groupId) {
    const group = await db.group.findFirst({ where: { id: groupId, teacherId: teacher.id } });
    if (!group) return validationError("المجموعة المحددة غير موجودة.");
    if (!stageValue) stageValue = group.stage;
  }

  // duplicate detection (same name + same group, or same phone)
  if (phone) {
    const dupPhone = await db.student.findFirst({
      where: { teacherId: teacher.id, phone },
    });
    if (dupPhone) return validationError("يوجد طالب آخر بنفس رقم الهاتف.");
  }
  if (groupId) {
    const dupName = await db.student.findFirst({
      where: { teacherId: teacher.id, name, groupId },
    });
    if (dupName) return validationError("يوجد طالب بنفس الاسم في هذه المجموعة.");
  }

  const orderIdx = await db.student.count({ where: { teacherId: teacher.id, groupId: groupId ?? null } });

  const student = await db.student.create({
    data: {
      teacherId: teacher.id,
      groupId: groupId,
      name,
      phone,
      stage: stageValue,
      code,
      orderIdx,
    },
  });

  // ensure a QR token exists for this student
  await ensureQrToken(teacher.id, student.id, () => generateToken(24));

  return Response.json({ ok: true, student });
}
