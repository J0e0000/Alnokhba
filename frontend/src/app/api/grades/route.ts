import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { pct } from "@/lib/arabic";

export const runtime = "nodejs";

/** GET /api/grades — all exam results for the teacher, grouped by exam. */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");

  const where: any = { teacherId: teacher.id };
  if (groupId && groupId !== "all") where.groupId = groupId;

  const exams = await db.exam.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      group: { select: { id: true, name: true } },
      results: {
        include: {
          student: { select: { id: true, name: true, orderIdx: true } },
        },
        orderBy: { student: { orderIdx: "asc" } },
      },
    },
    take: 50,
  });

  const result = exams.map((e) => {
    const graded = e.results.filter((r) => r.status === "graded");
    const scores = graded.map((r) => r.score);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const max = scores.length ? Math.max(...scores) : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const passed = e.passScore ? graded.filter((r) => r.score >= e.passScore).length : 0;
    const passRate = graded.length ? Math.round((passed / graded.length) * 100) : 0;

    return {
      id: e.id,
      title: e.title,
      maxScore: e.maxScore,
      passScore: e.passScore,
      status: e.status,
      group: e.group,
      createdAt: e.createdAt,
      stats: {
        total: e.results.length,
        graded: graded.length,
        pending: e.results.filter((r) => r.status === "pending").length,
        average: Math.round(avg * 100) / 100,
        highest: max,
        lowest: min,
        passRate,
      },
      results: e.results.map((r) => ({
        studentId: r.studentId,
        studentName: r.student.name,
        score: r.score,
        percentage: pct(r.score, e.maxScore),
        status: r.status,
        passed: e.passScore ? r.score >= e.passScore : null,
      })),
    };
  });

  return Response.json({ ok: true, exams: result });
}
