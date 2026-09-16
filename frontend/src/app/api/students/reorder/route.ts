import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";

/** POST /api/students/reorder — body: { items: [{ id, orderIdx }] } */
export async function POST(req: NextRequest) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return validationError("الطلب غير صحيح.");
  }
  const items: Array<{ id: string; orderIdx: number }> = body?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return validationError("لا توجد عناصر لإعادة ترتيبها.");
  }

  // verify all belong to teacher
  const ids = items.map((i) => i.id);
  const count = await db.student.count({ where: { id: { in: ids }, teacherId: teacher.id } });
  if (count !== ids.length) {
    return validationError("بعض الطلاب غير موجودة.");
  }

  await db.$transaction(
    items.map((i) =>
      db.student.update({ where: { id: i.id }, data: { orderIdx: i.orderIdx } })
    )
  );
  return Response.json({ ok: true });
}
