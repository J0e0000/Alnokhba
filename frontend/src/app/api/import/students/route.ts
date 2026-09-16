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

interface ImportRow {
  name: string;
  phone: string;
  stage: string;
  groupId: string;
  errors: string[];
  valid: boolean;
}

/** POST /api/import/students/validate
 *  body: { rows: [{ name, phone, stage, groupId }], groupId?: defaultGroup }
 *  Returns each row with validation errors. Does NOT write to DB.
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
  const rawRows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  const defaultGroup = (body?.groupId || "").toString().trim() || null;

  // fetch existing phones for duplicate detection
  const existingPhones = new Set<string>();
  const allStudents = await db.student.findMany({
    where: { teacherId: teacher.id },
    select: { phone: true },
  });
  for (const s of allStudents) if (s.phone) existingPhones.add(s.phone);

  // fetch groups for validation
  const groups = await db.group.findMany({
    where: { teacherId: teacher.id, archived: false },
    select: { id: true, name: true, stage: true },
  });
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  // track phones seen within this batch (intra-batch duplicate detection)
  const seenPhones = new Set<string>();

  const validated: ImportRow[] = rawRows.map((raw, idx) => {
    const errors: string[] = [];
    const name = (raw?.name || "").toString().trim();
    const phoneInput = (raw?.phone || "").toString().trim();
    const stage = (raw?.stage || "").toString().trim();
    const groupId = (raw?.groupId || defaultGroup || "").toString().trim();

    if (name.length < 3) errors.push("الاسم قصير جدًا (3 أحرف على الأقل).");
    if (name && !/^[\u0600-\u06FFa-zA-Z\s]+$/.test(name)) {
      errors.push("الاسم يحتوي على رموز غير صحيحة.");
    }

    let phoneNormalized = "";
    if (phoneInput) {
      const pc = validatePhone(phoneInput);
      if (!pc.ok) {
        errors.push(pc.error!);
      } else {
        phoneNormalized = pc.value;
        if (existingPhones.has(phoneNormalized)) {
          errors.push("رقم الهاتف مسجّل لطالب آخر بالفعل.");
        } else if (seenPhones.has(phoneNormalized)) {
          errors.push("رقم الهاتف مكرر داخل الملف.");
        } else {
          seenPhones.add(phoneNormalized);
        }
      }
    }

    if (stage) {
      const sc = validateStage(stage);
      if (!sc.ok) errors.push(sc.error!);
    }

    if (groupId) {
      const g = groupMap.get(groupId);
      if (!g) errors.push("المجموعة غير موجودة.");
    }

    return {
      name,
      phone: phoneNormalized || phoneInput,
      stage,
      groupId,
      errors,
      valid: errors.length === 0,
    };
  });

  const validCount = validated.filter((r) => r.valid).length;
  const errorCount = validated.length - validCount;

  return Response.json({
    ok: true,
    rows: validated,
    summary: { total: validated.length, valid: validCount, errors: errorCount },
    groups: groups.map((g) => ({ id: g.id, name: g.name, stage: g.stage })),
  });
}

/** PUT /api/import/students/confirm — actually write the validated rows.
 *  body: { rows: [{ name, phone, stage, groupId }] }
 */
export async function PUT(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) return validationError("لا توجد بيانات للاستيراد.");
  if (rows.length > 200) return validationError("الحد الأقصى 200 طالب في المرة الواحدة.");

  // re-validate server-side (never trust client)
  const validated: ImportRow[] = [];
  const existingPhones = new Set<string>();
  const allStudents = await db.student.findMany({
    where: { teacherId: teacher.id },
    select: { phone: true },
  });
  for (const s of allStudents) if (s.phone) existingPhones.add(s.phone);
  const seenPhones = new Set<string>();

  for (const raw of rows) {
    const errors: string[] = [];
    const name = (raw?.name || "").toString().trim();
    const phoneInput = (raw?.phone || "").toString().trim();
    const stage = (raw?.stage || "").toString().trim() || null;
    const groupId = (raw?.groupId || "").toString().trim() || null;

    if (name.length < 3) errors.push("الاسم قصير جدًا.");
    let phone: string | null = null;
    if (phoneInput) {
      const pc = validatePhone(phoneInput);
      if (!pc.ok) errors.push(pc.error!);
      else {
        phone = pc.value;
        if (existingPhones.has(phone) || seenPhones.has(phone)) {
          errors.push("هاتف مكرر.");
        } else {
          seenPhones.add(phone);
        }
      }
    }
    if (stage) {
      const sc = validateStage(stage);
      if (!sc.ok) errors.push(sc.error!);
    }
    validated.push({ name, phone: phone ?? phoneInput, stage, groupId, errors, valid: errors.length === 0 });
  }

  const invalid = validated.filter((r) => !r.valid);
  if (invalid.length > 0) {
    return validationError(
      `${invalid.length} صف يحتوي على أخطاء. صحّحها ثم أعد المحاولة.`
    );
  }

  // create students
  let created = 0;
  for (const r of validated) {
    let stageVal = r.stage || null;
    let groupVal = r.groupId || null;
    if (groupVal) {
      const g = await db.group.findFirst({ where: { id: groupVal, teacherId: teacher.id } });
      if (g && !stageVal) stageVal = g.stage;
    }
    const orderIdx = await db.student.count({
      where: { teacherId: teacher.id, groupId: groupVal ?? null },
    });
    const s = await db.student.create({
      data: {
        teacherId: teacher.id,
        groupId: groupVal,
        name: r.name,
        phone: r.phone || null,
        stage: stageVal,
        orderIdx,
      },
    });
    await ensureQrToken(teacher.id, s.id, () => generateToken(24));
    created++;
  }

  return Response.json({ ok: true, created });
}
