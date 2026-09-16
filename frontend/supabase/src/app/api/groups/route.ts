import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateStage } from "@/lib/validation";
import { WEEKDAY_NAMES, parseScheduleDays } from "@/lib/arabic";

export const runtime = "nodejs";

/** GET /api/groups — list groups for the current teacher (with counts). */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const stage = url.searchParams.get("stage") || "";
  const includeArchived = url.searchParams.get("archived") === "1";

  const where: any = { teacherId: teacher.id };
  if (!includeArchived) where.archived = false;
  if (stage && stage !== "all") where.stage = stage;
  if (search) where.name = { contains: search };

  const groups = await db.group.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { students: true, lessons: true, exams: true } },
    },
  });

  const result = groups.map((g) => ({
    id: g.id,
    name: g.name,
    stage: g.stage,
    scheduleDays: parseScheduleDays(g.scheduleDays),
    scheduleTime: g.scheduleTime,
    archived: g.archived,
    studentsCount: g._count.students,
    lessonsCount: g._count.lessons,
    examsCount: g._count.exams,
    scheduleLabel: scheduleLabel(g.scheduleDays, g.scheduleTime),
  }));

  return Response.json({ ok: true, groups: result });
}

function scheduleLabel(daysJson: string, time: string | null): string {
  const days = parseScheduleDays(daysJson);
  if (!days.length && !time) return "غير محدد";
  const names = days.map((d) => WEEKDAY_NAMES[d]).join("، ");
  return time ? `${names} — ${time}` : names;
}

/** POST /api/groups — create a new group. */
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
  const stage = (body?.stage || "").toString().trim();
  const scheduleDays: number[] = Array.isArray(body?.scheduleDays)
    ? body.scheduleDays.filter((n: any) => typeof n === "number" && n >= 0 && n <= 6)
    : [];
  const scheduleTime = (body?.scheduleTime || "").toString().trim() || null;

  if (name.length < 2) return validationError("اسم المجموعة يجب أن يكون حرفين على الأقل.");
  const stageCheck = validateStage(stage);
  if (!stageCheck.ok) return validationError(stageCheck.error!);

  // prevent duplicate group name for the same teacher
  const dup = await db.group.findFirst({ where: { teacherId: teacher.id, name } });
  if (dup) return validationError("يوجد مجموعة بنفس الاسم بالفعل.");

  const group = await db.group.create({
    data: {
      teacherId: teacher.id,
      name,
      stage,
      scheduleDays: JSON.stringify(scheduleDays),
      scheduleTime,
    },
  });
  return Response.json({ ok: true, group });
}
