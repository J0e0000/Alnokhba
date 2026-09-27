import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Renewal email (Resend HTTP API) ─────────────────────────────────────────
// REQUIRES (Supabase Dashboard → Edge Functions → admin-account-actions →
// Secrets, or `supabase secrets set`):
//   RESEND_API_KEY      — from resend.com/api-keys
//   RENEWAL_EMAIL_FROM  — optional, e.g. "Alnokhba <noreply@yourdomain.com>"
//                         (default "Alnokhba <onboarding@resend.dev>" works
//                         only while your Resend account is in test mode)
// CONTRACT: the renewal is saved FIRST; email failure NEVER rolls the
// renewal back — it is recorded on the renewal row (email_status/email_error)
// and returned so the admin sees "renewed but email failed" + can retry.
async function sendRenewalEmail(
  admin: ReturnType<typeof createClient>,
  opts: { renewalId: string; to: string; name: string; previousExpiresAt: string | null; newExpiresAt: string; planName: string | null; renewedAt: Date },
): Promise<{ sent: boolean; error: string | null }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RENEWAL_EMAIL_FROM") || "Alnokhba <onboarding@resend.dev>";

  const fail = async (error: string) => {
    await admin.from("subscription_renewals").update({ email_status: "failed", email_error: error }).eq("id", opts.renewalId);
    return { sent: false, error };
  };

  if (!apiKey) return await fail("RESEND_API_KEY غير مضبوط في إعدادات الدالة — أضف المفتاح ثم اضغط «إعادة إرسال الإيميل»");
  if (!opts.to) return await fail("لا يوجد بريد إلكتروني محفوظ لهذا الحساب");

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "—";
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const planLine = opts.planName ? `<tr><td style="padding:8px 12px;color:#64748B;font-weight:700;white-space:nowrap;">الباقة:</td><td style="padding:8px 12px;font-weight:700;color:#0E2954;">${esc(opts.planName)}</td></tr>` : "";
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;padding:24px;background:#F8FAFC;font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(14,41,84,.15);border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#0E2954,#142D62);padding:28px 24px;text-align:center;">
      <div style="font-size:30px;font-weight:800;color:#F5C542;">النخبة</div>
      <div style="font-size:13px;color:#CBD5E1;margin-top:4px;">إدارة الحصص الذكية</div>
    </div>
    <div style="padding:28px 24px;color:#1E293B;">
      <h1 style="font-size:20px;margin:0 0 12px;color:#0E2954;">تم تجديد اشتراكك بنجاح ✓</h1>
      <p style="font-size:14px;line-height:1.9;margin:0 0 16px;">مرحبًا <b>${esc(opts.name || "—")}</b>،</p>
      <p style="font-size:14px;line-height:1.9;margin:0 0 16px;">نؤكد لك أنه <b>تم تجديد اشتراكك بنجاح</b> في نظام النخبة بتاريخ ${fmt(opts.renewedAt.toISOString())}. حسابك فعّال من الآن وكل بياناتك كما هي.</p>
      <table style="width:100%;border-collapse:collapse;background:#F8FAFC;border:1px solid rgba(14,41,84,.12);border-radius:12px;font-size:14px;">
        <tr><td style="padding:8px 12px;color:#64748B;font-weight:700;white-space:nowrap;">الاسم:</td><td style="padding:8px 12px;font-weight:700;color:#0E2954;">${esc(opts.name || "—")}</td></tr>
        <tr><td style="padding:8px 12px;color:#64748B;font-weight:700;white-space:nowrap;">تاريخ التجديد:</td><td style="padding:8px 12px;font-weight:700;color:#0E2954;">${fmt(opts.renewedAt.toISOString())}</td></tr>
        ${opts.previousExpiresAt ? `<tr><td style="padding:8px 12px;color:#64748B;font-weight:700;white-space:nowrap;">تاريخ الانتهاء السابق:</td><td style="padding:8px 12px;font-weight:700;color:#0E2954;">${fmt(opts.previousExpiresAt)}</td></tr>` : ""}
        <tr><td style="padding:8px 12px;color:#64748B;font-weight:700;white-space:nowrap;">تاريخ الانتهاء الجديد:</td><td style="padding:8px 12px;font-weight:800;color:#B45309;">${fmt(opts.newExpiresAt)}</td></tr>
        ${planLine}
      </table>
      <p style="font-size:14px;line-height:1.9;margin:16px 0 0;">وبياناتك كلها <b>محفوظة</b> — الطلاب، الحضور، الدرجات، التقارير والإعدادات لم تُمس ولم تُحذف، وتجد كل شيء كما تركته.</p>
      <p style="font-size:12px;color:#64748B;margin:20px 0 0;border-top:1px solid rgba(14,41,84,.1);padding-top:14px;">تم الإنشاء من نظام النخبة — هذه رسالة تلقائية لا تحتاج ردًا.</p>
    </div>
  </div>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: "Your subscription has been renewed", html }),
    });
    if (!res.ok) {
      let detail = `Resend HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) detail = `${detail}: ${body.message}`;
      } catch { /* keep status-only detail */ }
      return await fail(detail);
    }
    await admin.from("subscription_renewals").update({ email_status: "sent", email_error: null, email_sent_at: new Date().toISOString() }).eq("id", opts.renewalId);
    return { sent: true, error: null };
  } catch (err) {
    return await fail(String((err as Error)?.message || err));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Missing authorization" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, is_admin, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.is_admin) return json({ error: "Admin access required" }, 403);

  let body: { action?: string; targetUserId?: string; password?: string; newExpiresAt?: string; planName?: string; renewalId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "confirm_account") {
    const targetUserId = String(body.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    const { error: profileUpdateError } = await admin.from("profiles").update({ is_verified: true }).eq("id", targetUserId);
    if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: targetUserId, action: "verify", details: "تأكيد الحساب من لوحة الأدمن" });
    return json({ ok: true, action: "confirm_account" });
  }

  if (body.action === "set_password") {
    const targetUserId = String(body.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
    const password = String(body.password || "");
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
    if (error) return json({ error: error.message }, 400);
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: targetUserId, action: "password_change", details: "تغيير كلمة المرور من لوحة الأدمن" });
    return json({ ok: true, action: "set_password" });
  }

  // ── تجديد الاشتراك: حفظ أولًا → سجل دائم → إيميل (فشل الإيميل لا يُرجع الحفظ) ──
  if (body.action === "renew_subscription") {
    const targetUserId = String(body.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
    const newExpiresAt = String(body.newExpiresAt || "").trim();
    const parsed = new Date(newExpiresAt);
    if (!newExpiresAt || isNaN(parsed.getTime())) return json({ error: "newExpiresAt must be a valid date" }, 400);
    const planName = body.planName ? String(body.planName).slice(0, 120) : null;

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, full_name, email, subscription_status, subscription_expires_at")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetError) return json({ error: targetError.message }, 400);
    if (!target) return json({ error: "Target account not found" }, 404);

    const isRenewal = parsed.getTime() > Date.now();
    const newStatus = isRenewal ? "active" : "expired";
    const previousExpiresAt = target.subscription_expires_at || null;
    const previousStatus = target.subscription_status || null;

    // 1) DB update — the source of truth. Failure here aborts everything (nothing half-done).
    const { error: updateError } = await admin
      .from("profiles")
      .update({ subscription_status: newStatus, subscription_expires_at: parsed.toISOString() })
      .eq("id", targetUserId);
    if (updateError) return json({ error: updateError.message }, 400);

    // 2) Permanent history row (append-only; never replaced or deleted).
    const daysAdded = previousExpiresAt
      ? Math.round((parsed.getTime() - new Date(previousExpiresAt).getTime()) / 86400000)
      : null;
    const { data: renewal, error: renewalError } = await admin
      .from("subscription_renewals")
      .insert({
        teacher_id: targetUserId,
        admin_id: user.id,
        previous_expires_at: previousExpiresAt,
        previous_status: previousStatus,
        new_expires_at: parsed.toISOString(),
        new_status: newStatus,
        plan_name: planName,
        days_added: daysAdded,
        email_status: "not_sent",
      })
      .select()
      .single();
    if (renewalError) {
      // Profile updated but history failed — report honestly, do NOT pretend full success.
      return json({ ok: true, partial: true, warning: `تم تحديث الاشتراك لكن تعذر كتابة سجل التجديد: ${renewalError.message}`, email: { attempted: false, sent: false, error: null } });
    }

    // 3) Existing activity/history system (admin_activity_log — same convention as before).
    await admin.from("admin_activity_log").insert({
      admin_id: user.id,
      target_teacher_id: targetUserId,
      action: "extend",
      details: isRenewal
        ? `تجديد الاشتراك حتى ${parsed.toLocaleDateString("ar-EG")}${planName ? ` — ${planName}` : ""}`
        : `تحديد تاريخ انتهاء سابق: ${parsed.toLocaleDateString("ar-EG")}`,
    });

    // 4) Email AFTER the DB save succeeded. Never rolls back; failure is recorded + returned.
    let email = { attempted: false, sent: false, error: null as string | null };
    if (isRenewal && target.email) {
      email.attempted = true;
      email = await sendRenewalEmail(admin, {
        renewalId: renewal.id,
        to: target.email,
        name: target.full_name || "",
        previousExpiresAt,
        newExpiresAt: parsed.toISOString(),
        planName,
        renewedAt: new Date(),
      });
    }

    return json({ ok: true, renewal, email });
  }

  // ── إعادة محاولة إرسال إيميل تجديد فاشل (بدون تغيير أي بيانات اشتراك) ──
  if (body.action === "retry_renewal_email") {
    const renewalId = String(body.renewalId || "").trim();
    if (!renewalId) return json({ error: "renewalId is required" }, 400);
    const { data: renewal, error: renewalError } = await admin
      .from("subscription_renewals")
      .select("id, teacher_id, previous_expires_at, new_expires_at, plan_name")
      .eq("id", renewalId)
      .maybeSingle();
    if (renewalError) return json({ error: renewalError.message }, 400);
    if (!renewal) return json({ error: "Renewal record not found" }, 404);

    const { data: target } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", renewal.teacher_id)
      .maybeSingle();

    const email = await sendRenewalEmail(admin, {
      renewalId: renewal.id,
      to: target?.email || "",
      name: target?.full_name || "",
      previousExpiresAt: renewal.previous_expires_at || null,
      newExpiresAt: renewal.new_expires_at,
      planName: renewal.plan_name || null,
      renewedAt: new Date(renewal.created_at || Date.now()),
    });
    return json({ ok: true, email });
  }

  return json({ error: "Unsupported action" }, 400);
});
