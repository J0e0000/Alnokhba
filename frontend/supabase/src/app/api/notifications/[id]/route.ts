import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTeacher } from "@/lib/auth";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** PATCH /api/notifications/[id] — mark as read. */
export async function PATCH(_req: NextRequest, ctx: RouteCtx) {
  const teacher = await requireTeacher();
  if (!teacher) return Response.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const { id } = await ctx.params;
  await db.notification.updateMany({
    where: { id, teacherId: teacher.id },
    data: { read: true },
  });
  return Response.json({ ok: true });
}
