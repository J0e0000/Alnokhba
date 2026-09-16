import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/search?q=... — global search across students, groups, lessons, exams. */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ ok: true, results: { students: [], groups: [], lessons: [], exams: [] } });

  const [students, groups, lessons, exams] = await Promise.all([
    db.student.findMany({
      where: {
        teacherId: teacher.id,
        archived: false,
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { code: { contains: q } },
        ],
      },
      take: 10,
      select: { id: true, name: true, phone: true, code: true, group: { select: { id: true, name: true } } },
    }),
    db.group.findMany({
      where: { teacherId: teacher.id, archived: false, name: { contains: q } },
      take: 5,
      select: { id: true, name: true, stage: true },
    }),
    db.lesson.findMany({
      where: {
        teacherId: teacher.id,
        OR: [{ title: { contains: q } }, { topic: { contains: q } }],
      },
      take: 5,
      select: { id: true, title: true, lessonDate: true, group: { select: { id: true, name: true } } },
      orderBy: { lessonDate: "desc" },
    }),
    db.exam.findMany({
      where: { teacherId: teacher.id, title: { contains: q } },
      take: 5,
      select: { id: true, title: true, status: true, maxScore: true, group: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return Response.json({
    ok: true,
    results: { students, groups, lessons, exams },
  });
}
