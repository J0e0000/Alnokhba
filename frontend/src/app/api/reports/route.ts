import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { pct } from "@/lib/arabic";

export const runtime = "nodejs";

/** GET /api/reports — analytics overview: attendance rates, grade distribution, at-risk students. */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");

  const studentWhere: any = { teacherId: teacher.id, archived: false };
  if (groupId && groupId !== "all") studentWhere.groupId = groupId;

  const students = await db.student.findMany({
    where: studentWhere,
    select: {
      id: true,
      name: true,
      code: true,
      group: { select: { id: true, name: true } },
      attendance: { select: { status: true } },
      results: {
        include: { exam: { select: { maxScore: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  // Per-student stats
  const studentStats = students.map((s) => {
    const present = s.attendance.filter((a) => a.status === "present").length;
    const absent = s.attendance.filter((a) => a.status === "absent").length;
    const late = s.attendance.filter((a) => a.status === "late").length;
    const total = s.attendance.length;
    const rate = total ? Math.round((present / total) * 100) : 0;
    const graded = s.results.filter((r) => r.status === "graded");
    const avgPct = graded.length
      ? Math.round(
          (graded.reduce((sum, r) => sum + pct(r.score, r.exam.maxScore), 0) / graded.length) * 10
        ) / 10
      : 0;
    const atRisk = absent >= teacher.absenceThreshold || avgPct < 50;
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      group: s.group,
      attendance: { present, absent, late, total, rate },
      grades: { average: avgPct, count: graded.length },
      atRisk,
    };
  });

  // Overall stats
  const totalStudents = students.length;
  const totalPresent = studentStats.reduce((s, x) => s + x.attendance.present, 0);
  const totalAbsent = studentStats.reduce((s, x) => s + x.attendance.absent, 0);
  const totalLate = studentStats.reduce((s, x) => s + x.attendance.late, 0);
  const totalAttendance = totalPresent + totalAbsent + totalLate;
  const overallRate = totalAttendance ? Math.round((totalPresent / totalAttendance) * 100) : 0;
  const atRiskCount = studentStats.filter((s) => s.atRisk).length;
  const avgGrade = studentStats.length
    ? Math.round((studentStats.reduce((s, x) => s + x.grades.average, 0) / studentStats.length) * 10) / 10
    : 0;

  // Grade distribution
  const distribution = { excellent: 0, good: 0, average: 0, weak: 0, failing: 0 };
  for (const s of studentStats) {
    if (s.grades.count === 0) continue;
    if (s.grades.average >= 85) distribution.excellent++;
    else if (s.grades.average >= 70) distribution.good++;
    else if (s.grades.average >= 50) distribution.average++;
    else if (s.grades.average >= 30) distribution.weak++;
    else distribution.failing++;
  }

  // Top performers
  const topPerformers = [...studentStats]
    .filter((s) => s.grades.count > 0)
    .sort((a, b) => b.grades.average - a.grades.average)
    .slice(0, 5);

  // Needs attention
  const needsAttention = studentStats
    .filter((s) => s.atRisk)
    .sort((a, b) => b.attendance.absent - a.attendance.absent)
    .slice(0, 10);

  return Response.json({
    ok: true,
    overall: {
      totalStudents,
      totalPresent,
      totalAbsent,
      totalLate,
      overallRate,
      atRiskCount,
      avgGrade,
    },
    distribution,
    topPerformers,
    needsAttention,
    students: studentStats,
  });
}
