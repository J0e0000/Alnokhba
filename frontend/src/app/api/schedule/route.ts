import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { parseScheduleDays, WEEKDAY_NAMES } from "@/lib/arabic";

export const runtime = "nodejs";

/** GET /api/schedule — weekly schedule view: groups + lessons organized by weekday. */
export async function GET() {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  // Get all active groups with their schedule
  const groups = await db.group.findMany({
    where: { teacherId: teacher.id, archived: false },
    select: {
      id: true,
      name: true,
      stage: true,
      scheduleDays: true,
      scheduleTime: true,
      _count: { select: { students: true } },
    },
    orderBy: { name: "asc" },
  });

  // Build weekday map
  const byDay: Record<number, Array<any>> = {};
  for (let i = 0; i < 7; i++) byDay[i] = [];

  for (const g of groups) {
    const days = parseScheduleDays(g.scheduleDays);
    for (const d of days) {
      byDay[d].push({
        id: g.id,
        name: g.name,
        stage: g.stage,
        time: g.scheduleTime,
        studentsCount: g._count.students,
      });
    }
  }

  const weekdays = Array.from({ length: 7 }, (_, i) => ({
    index: i,
    name: WEEKDAY_NAMES[i],
    groups: byDay[i].sort((a, b) => (a.time || "").localeCompare(b.time || "")),
  }));

  return Response.json({
    ok: true,
    weekdays,
    unscheduled: groups.filter((g) => parseScheduleDays(g.scheduleDays).length === 0).map((g) => ({
      id: g.id,
      name: g.name,
      stage: g.stage,
      studentsCount: g._count.students,
    })),
  });
}
