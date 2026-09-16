import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateDate } from "@/lib/validation";
import { todayStr } from "@/lib/arabic";

export const runtime = "nodejs";

/** GET /api/lessons — list lessons, optionally filtered by date / group. */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date"); // yyyy-mm-dd
  const groupId = url.searchParams.get("groupId");
  const today = url.searchParams.get("today") === "1";
  const upcoming = url.searchParams.get("upcoming") === "1";

  const where: any = { teacherId: teacher.id };
  if (today) where.lessonDate = todayStr();
  else if (date) where.lessonDate = date;
  if (groupId && groupId !== "all") where.groupId = groupId;

  if (upcoming) {
    const t = todayStr();
    where.lessonDate = { gte: t };
  }

  const lessons = await db.lesson.findMany({
    where,
    orderBy: [{ lessonDate: "desc" }, { createdAt: "desc" }],
    include: {
      group: { select: { id: true, name: true, stage: true } },
      _count: { select: { attendance: true } },
    },
    take: 100,
  });

  // attach present/absent counts
  const result = await Promise.all(
    lessons.map(async (l) => {
      const present = await db.attendance.count({
        where: { lessonId: l.id, status: "present" },
      });
      const absent = await db.attendance.count({
        where: { lessonId: l.id, status: "absent" },
      });
      const studentCount = await db.student.count({
        where: { groupId: l.groupId, archived: false },
      });
      return {
        id: l.id,
        title: l.title,
        topic: l.topic,
        lessonDate: l.lessonDate,
        startTime: l.startTime,
        endTime: l.endTime,
        status: l.status,
        closedAt: l.closedAt,
        videoUrl: l.videoUrl,
        group: l.group,
        studentCount,
        presentCount: present,
        absentCount: absent,
      };
    })
  );

  return Response.json({ ok: true, lessons: result });
}

/** POST /api/lessons — create a lesson. */
export async function POST(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const groupId = (body?.groupId || "").toString().trim();
  const title = (body?.title || "").toString().trim();
  const topic = (body?.topic || "").toString().trim() || null;
  const lessonDate = (body?.lessonDate || "").toString().trim();
  const startTime = (body?.startTime || "").toString().trim() || null;
  const endTime = (body?.endTime || "").toString().trim() || null;
  const videoUrl = (body?.videoUrl || "").toString().trim() || null;

  if (!groupId) return validationError("المجموعة مطلوبة.");
  const group = await db.group.findFirst({ where: { id: groupId, teacherId: teacher.id } });
  if (!group) return validationError("المجموعة غير موجودة.");
  if (title.length < 2) return validationError("عنوان الحصة يجب أن يكون حرفين على الأقل.");
  const dateCheck = validateDate(lessonDate);
  if (!dateCheck.ok) return validationError(dateCheck.error!);

  // prevent duplicate lesson (same group + same date)
  const dup = await db.lesson.findFirst({
    where: { teacherId: teacher.id, groupId, lessonDate },
  });
  if (dup) return validationError("يوجد حصة بالفعل لهذه المجموعة في هذا اليوم.");

  const lesson = await db.lesson.create({
    data: {
      teacherId: teacher.id,
      groupId,
      title,
      topic,
      lessonDate,
      startTime,
      endTime,
      videoUrl,
      status: "open",
    },
    include: { group: { select: { id: true, name: true, stage: true } } },
  });

  // auto-create attendance rows (default 'absent') for every student in the group
  const students = await db.student.findMany({
    where: { groupId, archived: false },
    select: { id: true },
  });
  if (students.length) {
    await db.attendance.createMany({
      data: students.map((s) => ({
        teacherId: teacher.id,
        studentId: s.id,
        lessonId: lesson.id,
        status: "absent",
        method: "auto",
      })),
      skipDuplicates: true,
    });
  }

  return Response.json({ ok: true, lesson });
}
