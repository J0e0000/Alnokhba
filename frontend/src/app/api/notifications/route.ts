import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/notifications — list teacher notifications. */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";

  const where: any = { teacherId: teacher.id, audience: "teacher" };
  if (unreadOnly) where.read = false;

  const items = await db.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  // Fetch student names separately for notifications that have a studentId
  const studentIds = [...new Set(items.filter((n) => n.studentId).map((n) => n.studentId!))];
  const students = studentIds.length
    ? await db.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, name: true },
      })
    : [];
  const studentMap = new Map(students.map((s) => [s.id, s]));

  const unread = await db.notification.count({
    where: { teacherId: teacher.id, audience: "teacher", read: false },
  });

  return Response.json({
    ok: true,
    notifications: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      createdAt: n.createdAt,
      studentId: n.studentId,
      student: n.studentId ? studentMap.get(n.studentId) || null : null,
    })),
    unread,
  });
}

/** POST /api/notifications/read-all — mark all as read. */
export async function POST() {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  await db.notification.updateMany({
    where: { teacherId: teacher.id, audience: "teacher", read: false },
    data: { read: true },
  });
  return Response.json({ ok: true });
}
