import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError, validateScore } from "@/lib/validation";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

/** GET /api/exams — list exams for the teacher (filter by group/status). */
export async function GET(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  const where: any = { teacherId: teacher.id };
  if (groupId && groupId !== "all") where.groupId = groupId;
  if (status && status !== "all") where.status = status;
  if (search) where.title = { contains: search };

  const exams = await db.exam.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      group: { select: { id: true, name: true } },
      _count: { select: { results: true } },
    },
    take: 100,
  });

  return Response.json({
    ok: true,
    exams: exams.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      maxScore: e.maxScore,
      passScore: e.passScore,
      status: e.status,
      lessonDate: e.lessonDate,
      publishedAt: e.publishedAt,
      group: e.group,
      resultsCount: e._count.results,
      createdAt: e.createdAt,
    })),
  });
}

/** POST /api/exams — create a new exam. */
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
  const groupId = (body?.groupId || "").toString().trim() || null;
  const maxScore = Number(body?.maxScore);
  const passScore = body?.passScore ? Number(body.passScore) : null;
  const lessonDate = (body?.lessonDate || "").toString().trim() || null;
  const questions = Array.isArray(body?.questions) ? body.questions : [];
  const status = (body?.status || "draft").toString();

  if (title.length < 3) return validationError("عنوان الامتحان يجب أن يكون 3 أحرف على الأقل.");
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return validationError("الدرجة العظمى يجب أن تكون رقمًا موجبًا.");
  }
  if (passScore !== null) {
    if (passScore < 0 || passScore > maxScore) {
      return validationError(`درجة النجاح يجب أن تكون بين 0 و ${maxScore}.`);
    }
  }
  if (groupId) {
    const g = await db.group.findFirst({ where: { id: groupId, teacherId: teacher.id } });
    if (!g) return validationError("المجموعة غير موجودة.");
  }

  // pre-create empty results for each student of the group (status pending)
  const exam = await db.exam.create({
    data: {
      teacherId: teacher.id,
      groupId,
      title,
      description,
      maxScore,
      passScore,
      lessonDate,
      status: status === "published" ? "published" : "draft",
      publishedAt: status === "published" ? new Date() : null,
      questionsJson: JSON.stringify(questions),
    },
  });

  if (groupId) {
    const students = await db.student.findMany({
      where: { groupId, archived: false },
      select: { id: true },
    });
    if (students.length) {
      await db.examResult.createMany({
        data: students.map((s) => ({
          teacherId: teacher.id,
          examId: exam.id,
          studentId: s.id,
          score: 0,
          status: "pending",
        })),
        skipDuplicates: true,
      });
    }
    if (status === "published") {
      await notify({
        teacherId: teacher.id,
        audience: "student",
        type: "exam",
        title: "تم نشر امتحان جديد",
        body: `تم نشر امتحان "${title}".`,
      });
    }
  }

  return Response.json({ ok: true, exam });
}
