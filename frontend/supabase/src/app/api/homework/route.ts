import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateDate } from "@/lib/validation";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

/** GET /api/homework — list homework (filter by group/lesson). */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");
  const lessonId = url.searchParams.get("lessonId");

  const where: any = { teacherId: teacher.id };
  if (groupId && groupId !== "all") where.groupId = groupId;
  if (lessonId) where.lessonId = lessonId;

  const hw = await db.homework.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      group: { select: { id: true, name: true } },
      lesson: { select: { id: true, title: true, lessonDate: true } },
      _count: { select: { status: true } },
    },
    take: 100,
  });
  return Response.json({ ok: true, homework: hw });
}

/** POST /api/homework — create homework. */
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
  const description = (body?.description || "").toString().trim() || null;
  const groupId = (body?.groupId || "").toString().trim();
  const lessonId = (body?.lessonId || "").toString().trim() || null;
  const dueDate = (body?.dueDate || "").toString().trim() || null;

  if (title.length < 3) return validationError("عنوان الواجب يجب أن يكون 3 أحرف على الأقل.");
  const group = await db.group.findFirst({ where: { id: groupId, teacherId: teacher.id } });
  if (!group) return validationError("المجموعة غير موجودة.");
  if (dueDate) {
    const d = validateDate(dueDate);
    if (!d.ok) return validationError(d.error!);
  }
  if (lessonId) {
    const l = await db.lesson.findFirst({ where: { id: lessonId, teacherId: teacher.id } });
    if (!l) return validationError("الحصة غير موجودة.");
  }

  const hw = await db.homework.create({
    data: {
      teacherId: teacher.id,
      groupId,
      lessonId,
      title,
      description,
      dueDate,
    },
  });

  // create homework_status rows for each student in the group
  const students = await db.student.findMany({
    where: { groupId, archived: false },
    select: { id: true },
  });
  if (students.length) {
    await db.homeworkStatus.createMany({
      data: students.map((s) => ({ homeworkId: hw.id, studentId: s.id, done: false })),
      skipDuplicates: true,
    });
  }

  await notify({
    teacherId: teacher.id,
    audience: "student",
    type: "homework",
    title: "واجب جديد",
    body: `تم إضافة واجب: "${title}".`,
  });

  return Response.json({ ok: true, homework: hw });
}
