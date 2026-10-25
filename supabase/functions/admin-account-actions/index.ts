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
// Email config resolution order (Task 44j): env var RESEND_API_KEY first
// (platform-level), then the DB table admin_email_config written by the admin
// from the dashboard (لوحة الأدمن → سجل التجديدات → ⚙️ إعدادات البريد) via the
// set_email_config action below. Optional RENEWAL_EMAIL_FROM: env, then DB,
// then "onboarding@resend.dev" (Resend test-mode sender).
// CONTRACT: the renewal is saved FIRST; email failure NEVER rolls the
// renewal back — it is recorded on the renewal row (email_status/email_error)
// and returned so the admin sees "renewed but email failed" + can retry.
type EmailConfig = { apiKey: string | null; from: string };

async function getEmailConfig(admin: ReturnType<typeof createClient>): Promise<EmailConfig> {
  let dbKey: string | null = null;
  let dbFrom: string | null = null;
  try {
    const { data } = await admin.from("admin_email_config").select("key,value");
    for (const row of data ?? []) {
      if (row.key === "resend_api_key") dbKey = row.value;
      else if (row.key === "renewal_email_from") dbFrom = row.value;
    }
  } catch (err) {
    // Table not migrated yet — env-only mode still works.
    console.error("[admin-account-actions] admin_email_config read failed:", String(err));
  }
  return {
    apiKey: Deno.env.get("RESEND_API_KEY") || dbKey,
    from: Deno.env.get("RENEWAL_EMAIL_FROM") || dbFrom || "Alnokhba <onboarding@resend.dev>",
  };
}

const maskKey = (k: string) => (k.length <= 10 ? "re_…" : `${k.slice(0, 6)}…${k.slice(-4)}`);

async function sendRenewalEmail(
  admin: ReturnType<typeof createClient>,
  opts: { renewalId: string; to: string; name: string; previousExpiresAt: string | null; newExpiresAt: string; planName: string | null; renewedAt: Date; apiKey: string | null; from: string },
): Promise<{ sent: boolean; error: string | null }> {
  const { apiKey, from } = opts;

  const fail = async (error: string) => {
    await admin.from("subscription_renewals").update({ email_status: "failed", email_error: error }).eq("id", opts.renewalId);
    return { sent: false, error };
  };

  if (!apiKey) return await fail("لا يوجد مفتاح إرسال بعد — من لوحة الأدمن → سجل التجديدات → ⚙️ إعدادات البريد: الصق مفتاح Resend واحفظ ثم اضغط هنا مجددًا");
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

// ── Audit + rate-limit helpers (migration_049) ──────────────────────────────
// admin_log_audit: writes into the append-only admin_audit_logs table. The
// caller is always a verified admin (checked above) — service-role context
// passes the actor id explicitly. NEVER include passwords/tokens in metadata.
async function audit(
  admin: ReturnType<typeof createClient>,
  opts: { action: string; actorId: string; targetUserId?: string | null; reason?: string | null; details?: string | null; metadata?: Record<string, unknown>; success?: boolean },
) {
  try {
    await admin.rpc("admin_log_audit", {
      p_action: opts.action,
      p_target_user_id: opts.targetUserId ?? null,
      p_reason: opts.reason ?? null,
      p_details: opts.details ?? null,
      p_metadata: opts.metadata ?? {},
      p_actor_id: opts.actorId,
      p_success: opts.success ?? true,
    });
  } catch (err) {
    // Auditing must never break the main flow — but failures are surfaced in logs.
    console.error("[admin-account-actions] audit write failed:", String(err));
  }
}

// consume_rate_limit (migration_049): atomic sliding-window counter per
// admin+action. Admin actions are rare by nature — a burst means either a
// stuck client or a hijacked session; both must be throttled.
async function rateLimited(
  admin: ReturnType<typeof createClient>,
  opts: { key: string; max: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_key: opts.key,
    p_max: opts.max,
    p_window_seconds: opts.windowSeconds,
  });
  if (error) {
    console.error("[admin-account-actions] rate-limit rpc failed:", error.message);
    return true; // fail-open: availability over strictness when the limiter itself errors
  }
  return data === true;
}

// Handler extracted from Deno.serve so the wrapper below can catch ANY
// unexpected throw (bad import, env glitch, library error) and still return a
// readable JSON error — a bare platform 500 is what produced the opaque
// "Edge Function returned a non-2x status code" toast on the client.
async function handleAdminAction(req: Request): Promise<Response> {
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

  // Per-admin burst guard: 40 admin operations / 5 minutes (all actions).
  if (!(await rateLimited(admin, { key: `aaa:${user.id}`, max: 40, windowSeconds: 300 }))) {
    await audit(admin, { action: "rate_limit_block", actorId: user.id, success: false, details: "تجاوز حد عمليات لوحة الأدمن مؤقتًا" });
    return json({ error: "Too many admin operations — try again in a few minutes" }, 429);
  }

  let body: {
    action?: string; targetUserId?: string; password?: string; newExpiresAt?: string;
    planName?: string; renewalId?: string; reason?: string;
    teamId?: string; days?: number; sendEmail?: boolean;
    resendApiKey?: string; from?: string; to?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "confirm_account") {
    const targetUserId = String(body.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { email_confirm: true });
    if (error) { await audit(admin, { action: "confirm_account", actorId: user.id, targetUserId, success: false, details: error.message }); return json({ error: error.message }, 400); }
    const { error: profileUpdateError } = await admin.from("profiles").update({ is_verified: true }).eq("id", targetUserId);
    if (profileUpdateError) { await audit(admin, { action: "confirm_account", actorId: user.id, targetUserId, success: false, details: profileUpdateError.message }); return json({ error: profileUpdateError.message }, 400); }
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: targetUserId, action: "verify", details: "تأكيد الحساب من لوحة الأدمن" });
    await audit(admin, { action: "confirm_account", actorId: user.id, targetUserId, details: "تأكيد الحساب" });
    return json({ ok: true, action: "confirm_account" });
  }

  if (body.action === "set_password") {
    const targetUserId = String(body.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
    const password = String(body.password || "");
    if (password.length < 10) return json({ error: "Password must be at least 10 characters" }, 400);
    // Tighter burst guard for password resets: 10 / 5 minutes per admin.
    if (!(await rateLimited(admin, { key: `aaa-pw:${user.id}`, max: 10, windowSeconds: 300 }))) {
      await audit(admin, { action: "set_password", actorId: user.id, targetUserId, success: false, details: "تجاوز حد تغيير كلمات المرور مؤقتًا" });
      return json({ error: "Too many password resets — try again in a few minutes" }, 429);
    }
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
    if (error) { await audit(admin, { action: "set_password", actorId: user.id, targetUserId, success: false, details: error.message }); return json({ error: error.message }, 400); }
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: targetUserId, action: "password_change", details: "تغيير كلمة المرور من لوحة الأدمن" });
    // NEVER log the password value itself — only that a reset happened.
    await audit(admin, { action: "set_password", actorId: user.id, targetUserId, details: "تغيير كلمة المرور" });
    return json({ ok: true, action: "set_password" });
  }

  // ── تعطيل / تفعيل حساب (auth ban) — بيانات صاحبه لا تُمس نهائيًا ──
  if (body.action === "disable_user" || body.action === "enable_user") {
    const targetUserId = String(body.targetUserId || "").trim();
    if (!targetUserId) return json({ error: "targetUserId is required" }, 400);
    if (targetUserId === user.id) return json({ error: "لا يمكنك تعطيل حسابك أنت" }, 400);
    const reason = body.reason ? String(body.reason).slice(0, 300) : null;
    // GoTrue ban: long-duration ban disables; empty ban_duration unbans.
    const { error } = await admin.auth.admin.updateUserById(targetUserId,
      body.action === "disable_user" ? { ban_duration: "876000h" } : { ban_duration: "none" });
    if (error) { await audit(admin, { action: body.action, actorId: user.id, targetUserId, success: false, details: error.message }); return json({ error: error.message }, 400); }
    await audit(admin, {
      action: body.action,
      actorId: user.id,
      targetUserId,
      reason,
      details: body.action === "disable_user" ? "تعطيل الحساب (حظر دخول مؤقت بلا حذف بيانات)" : "إعادة تفعيل الحساب",
      metadata: { reason },
    });
    return json({ ok: true, action: body.action });
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
    // Audit mirror (append-only admin_audit_logs) with the real outcome metadata.
    await audit(admin, {
      action: "renew_subscription",
      actorId: user.id,
      targetUserId,
      details: isRenewal ? `تجديد الاشتراك حتى ${parsed.toISOString().slice(0, 10)}` : "تحديد تاريخ انتهاء سابق",
      metadata: { previous_expires_at: previousExpiresAt, new_expires_at: parsed.toISOString(), plan_name: planName, days_added: daysAdded },
    });

    // 4) Email AFTER the DB save succeeded. Never rolls back; failure is recorded + returned.
    let email = { attempted: false, sent: false, error: null as string | null };
    if (isRenewal && target.email) {
      email.attempted = true;
      const cfg = await getEmailConfig(admin);
      email = await sendRenewalEmail(admin, {
        renewalId: renewal.id,
        to: target.email,
        name: target.full_name || "",
        previousExpiresAt,
        newExpiresAt: parsed.toISOString(),
        planName,
        renewedAt: new Date(),
        apiKey: cfg.apiKey,
        from: cfg.from,
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
      ...(await getEmailConfig(admin)),
    });
    return json({ ok: true, email });
  }

  // ── إعدادات البريد (Task 44j): الأدمن يلصق مفتاح Resend من لوحة الأدمن نفسها ──
  // بدل ما يحتاج Supabase Dashboard/secrets يدويًا. المفتاح لا يُعاد كاملًا
  // أبدًا للعميل — نسخة مقنّعة فقط.Env var يفضل له الأولوية لو موجود.
  if (body.action === "get_email_config") {
    const cfg = await getEmailConfig(admin);
    const source = Deno.env.get("RESEND_API_KEY") ? "env" : cfg.apiKey ? "db" : "none";
    return json({ ok: true, configured: !!cfg.apiKey, masked_key: cfg.apiKey ? maskKey(cfg.apiKey) : null, from: cfg.from, source });
  }

  if (body.action === "set_email_config") {
    const apiKey = body.resendApiKey != null ? String(body.resendApiKey).trim() : "";
    const from = body.from != null ? String(body.from).trim() : "";
    // مفتاح Resend يبدأ بـ re_ (بصيغة re_<id>-<secret>). نرفض أي شكل آخر مبكرًا
    // عشان خطأ لصق واضح بدل فشل إرسال غامض لاحقًا.
    if (apiKey && !/^re_[A-Za-z0-9_\-]{10,200}$/.test(apiKey)) {
      return json({ error: "شكل المفتاح غير صحيح — مفتاح Resend يبدأ بـ re_ (من resend.com/api-keys)" }, 400);
    }
    if (from.length > 200) return json({ error: "قيمة المُرسل طويلة جدًا (الحد 200 حرف)" }, 400);

    const rows: Array<{ key: string; value: string; updated_by: string }> = [];
    if (apiKey) rows.push({ key: "resend_api_key", value: apiKey, updated_by: user.id });
    if (from) rows.push({ key: "renewal_email_from", value: from, updated_by: user.id });

    if (rows.length) {
      const { error } = await admin.from("admin_email_config").upsert(rows, { onConflict: "key" });
      const undefinedTable = error && (error.code === "42P01" || /does not exist|schema cache|admin_email_config/i.test(error.message || ""));
      if (error) return json({ error: undefinedTable ? "جدول الإعدادات غير منشّر بعد — شغّل migration_060 أولًا" : error.message }, 400);
    }
    const keysToClear: string[] = [];
    if (body.resendApiKey != null && !apiKey) keysToClear.push("resend_api_key");
    if (body.from != null && !from) keysToClear.push("renewal_email_from");
    if (keysToClear.length) {
      await admin.from("admin_email_config").delete().in("key", keysToClear);
    }

    await audit(admin, {
      action: "set_email_config",
      actorId: user.id,
      details: `تحديث إعدادات البريد — المفتاح: ${apiKey ? "حُدّث (" + maskKey(apiKey) + ")" : keysToClear.includes("resend_api_key") ? "اتمسح" : "بدون تغيير"} · المُرسل: ${from ? "حُدّث" : keysToClear.includes("renewal_email_from") ? "اتمسح" : "بدون تغيير"}`,
      metadata: { key_masked: apiKey ? maskKey(apiKey) : null, from_set: !!from },
    });
    const cfg = await getEmailConfig(admin);
    return json({ ok: true, configured: !!cfg.apiKey, masked_key: cfg.apiKey ? maskKey(cfg.apiKey) : null, from: cfg.from });
  }

  // ── إيميل تجريبي: التأكد من الإعدادات قبل أول تجديد حقيقي ──
  if (body.action === "send_test_email") {
    const to = String(body.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return json({ error: "اكتب بريدًا صحيحًا للاختبار" }, 400);
    const cfg = await getEmailConfig(admin);
    if (!cfg.apiKey) return json({ ok: true, email: { sent: false, error: "لا يوجد مفتاح محفوظ بعد — الصق المفتاح واحفظ أولًا" } });

    const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;padding:24px;background:#F8FAFC;font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid rgba(14,41,84,.15);border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0E2954,#142D62);padding:24px;text-align:center;">
        <div style="font-size:26px;font-weight:800;color:#F5C542;">النخبة</div>
      </div>
      <div style="padding:24px;color:#1E293B;">
        <h1 style="font-size:18px;margin:0 0 10px;color:#0E2954;">إعدادات البريد تعمل ✓</h1>
        <p style="font-size:14px;line-height:1.9;margin:0;">دي رسالة اختبار اتبعتت من لوحة الأدمن بعد ضبط مفتاح الإرسال — من دلوقتي إيميلات التجديد هتوص للمدرّسين تلقائيًا.</p>
        <p style="font-size:12px;color:#64748B;margin:16px 0 0;">${new Date().toLocaleString("ar-EG")}</p>
      </div>
    </div>
  </body></html>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.from, to: [to], subject: "اختبار إعدادات البريد — النخبة", html }),
      });
      if (!res.ok) {
        let detail = `Resend HTTP ${res.status}`;
        try {
          const b = await res.json();
          if (b?.message) detail = `${detail}: ${b.message}`;
        } catch { /* keep status-only detail */ }
        return json({ ok: true, email: { sent: false, error: detail } });
      }
      return json({ ok: true, email: { sent: true, error: null } });
    } catch (err) {
      return json({ ok: true, email: { sent: false, error: String((err as Error)?.message || err) } });
    }
  }

  // ── تجديد اشتراك فريق كامل دفعة واحدة (Task 44j) ──
  // وضعان: تاريخ انتهاء موحّد للجميع، أو تمديد بالأيام يُحسب لكل عضو من
  // أقصى(الآن، تاريخ انتهائه الحالي) — نفس قاعدة التجديد الفردي بالضبط.
  // الحفظ أولًا لكل عضو → صف سجل دائم لكل عضو → إيميل جماعي فشله لا يلمس الاشتراكات.
  if (body.action === "renew_team_subscription") {
    const teamId = String(body.teamId || "").trim();
    if (!teamId) return json({ error: "teamId is required" }, 400);
    const planName = body.planName ? String(body.planName).slice(0, 120) : null;
    const sendEmail = body.sendEmail !== false;

    let fixedDate: Date | null = null;
    let days: number | null = null;
    if (body.newExpiresAt) {
      const parsed = new Date(String(body.newExpiresAt).trim());
      if (isNaN(parsed.getTime())) return json({ error: "newExpiresAt must be a valid date" }, 400);
      fixedDate = parsed;
    } else if (body.days != null && Number.isFinite(Number(body.days))) {
      days = Math.round(Number(body.days));
      if (days <= 0 || days > 3650) return json({ error: "عدد الأيام لازم يكون بين 1 و 3650" }, 400);
    } else {
      return json({ error: "حدد تاريخ انتهاء موحّد أو عدد أيام التمديد" }, 400);
    }

    const { data: team, error: teamError } = await admin.from("admin_teams").select("id, name").eq("id", teamId).maybeSingle();
    if (teamError) return json({ error: teamError.message }, 400);
    if (!team) return json({ error: "الفريق غير موجود" }, 404);

    const { data: memberRows, error: membersError } = await admin.from("admin_team_members").select("profile_id").eq("team_id", teamId);
    if (membersError) return json({ error: membersError.message }, 400);
    const memberIds = (memberRows ?? []).map((m) => m.profile_id);
    if (memberIds.length === 0) return json({ error: "الفريق لا يحتوي أعضاء — أضف أعضاء أولًا" }, 400);
    if (memberIds.length > 100) return json({ error: `الفريق به ${memberIds.length} عضو — الحد الأقصى للتجديد الجماعي 100 عضو في المرة` }, 400);

    const { data: targets, error: targetsError } = await admin
      .from("profiles")
      .select("id, full_name, email, phone, subscription_status, subscription_expires_at")
      .in("id", memberIds);
    if (targetsError) return json({ error: targetsError.message }, 400);

    const emailConfig = await getEmailConfig(admin);
    const renewed: Array<{ id: string; name: string; phone: string; previous_expires_at: string | null; days_added: number | null; new_expires_at: string }> = [];
    const failures: Array<{ id: string; name: string; error: string }> = [];
    const emailQueue: Array<{ renewalId: string; to: string; name: string; previousExpiresAt: string | null; newExpiresAt: string }> = [];

    for (const target of targets ?? []) {
      let newExpires: Date;
      if (fixedDate) {
        newExpires = fixedDate;
      } else {
        const base = target.subscription_expires_at && new Date(target.subscription_expires_at).getTime() > Date.now()
          ? new Date(target.subscription_expires_at)
          : new Date();
        base.setDate(base.getDate() + (days as number));
        newExpires = base;
      }
      const isRenewal = newExpires.getTime() > Date.now();
      const newStatus = isRenewal ? "active" : "expired";
      const previousExpiresAt = target.subscription_expires_at || null;

      const { error: updateError } = await admin
        .from("profiles")
        .update({ subscription_status: newStatus, subscription_expires_at: newExpires.toISOString() })
        .eq("id", target.id);
      if (updateError) {
        failures.push({ id: target.id, name: target.full_name || target.email || target.id, error: updateError.message });
        continue;
      }

      const daysAdded = previousExpiresAt
        ? Math.round((newExpires.getTime() - new Date(previousExpiresAt).getTime()) / 86400000)
        : days;
      const { data: renewal, error: renewalError } = await admin
        .from("subscription_renewals")
        .insert({
          teacher_id: target.id,
          admin_id: user.id,
          previous_expires_at: previousExpiresAt,
          previous_status: target.subscription_status || null,
          new_expires_at: newExpires.toISOString(),
          new_status: newStatus,
          plan_name: planName,
          days_added: daysAdded,
          email_status: "not_sent",
        })
        .select()
        .single();
      if (renewalError) {
        // نفس قاعدة التجديد الفردي: الاشتراك اتحفظ — نبلّغ honestly بدون ادعاء نجاح كامل.
        failures.push({ id: target.id, name: target.full_name || target.email || target.id, error: `اتحفظ الاشتراك لكن فشل سجل التجديد: ${renewalError.message}` });
        continue;
      }

      // 44l: phone + previous expiry + days_added travel back to the client so
      // the admin UI can build the branded WhatsApp receipt (وصل تجديد)
      // without a second query — email is no longer the only channel.
      renewed.push({
        id: target.id,
        name: target.full_name || target.email || target.id,
        phone: target.phone || "",
        previous_expires_at: previousExpiresAt,
        days_added: daysAdded,
        new_expires_at: newExpires.toISOString(),
      });
      if (sendEmail && isRenewal && target.email) {
        emailQueue.push({ renewalId: renewal.id, to: target.email, name: target.full_name || "", previousExpiresAt, newExpiresAt: newExpires.toISOString() });
      }
    }

    // إيميلات جماعية — دفعات متوازية صغيرة؛ فشل إيميل عضو لا يوقف الباقي
    // (يتسجل على صف التجديد الخاص به ويظهر زر إعادة الإرسال).
    const emailResults = { attempted: 0, sent: 0, failed: [] as Array<{ name: string; error: string }> };
    const CHUNK = 5;
    for (let i = 0; i < emailQueue.length; i += CHUNK) {
      const chunk = emailQueue.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((e) =>
          sendRenewalEmail(admin, {
            renewalId: e.renewalId, to: e.to, name: e.name,
            previousExpiresAt: e.previousExpiresAt, newExpiresAt: e.newExpiresAt,
            planName, renewedAt: new Date(), apiKey: emailConfig.apiKey, from: emailConfig.from,
          }),
        ),
      );
      settled.forEach((res, idx) => {
        const item = chunk[idx];
        emailResults.attempted++;
        if (res.status === "fulfilled" && res.value.sent) emailResults.sent++;
        else {
          const errStr = res.status === "rejected" ? String((res.reason as Error)?.message || res.reason) : res.value.error || "سبب غير معروف";
          emailResults.failed.push({ name: item.name || item.to, error: errStr });
        }
      });
    }

    const untilLabel = fixedDate ? fixedDate.toLocaleDateString("ar-EG") : `تمديد ${(days as number)} يوم`;
    const summary = `تجديد اشتراك الفريق «${team.name}» بالكامل — ${renewed.length}/${(targets ?? []).length} عضو (${untilLabel})${planName ? ` — ${planName}` : ""}`;
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: null, action: "extend", details: summary });
    await audit(admin, {
      action: "renew_team_subscription",
      actorId: user.id,
      details: summary,
      metadata: {
        team_id: teamId, team_name: team.name, member_count: (targets ?? []).length,
        renewed: renewed.length, failed_count: failures.length,
        fixed_date: fixedDate ? fixedDate.toISOString() : null, days: days,
        plan_name: planName, emails_sent: emailResults.sent, emails_failed: emailResults.failed.length,
      },
    });

    return json({ ok: true, team: { id: team.id, name: team.name }, total: (targets ?? []).length, renewed, failures, email: emailResults, summary });
  }

  return json({ error: "Unsupported action" }, 400);
}

Deno.serve(async (req: Request) => {
  try {
    return await handleAdminAction(req);
  } catch (err) {
    console.error("[admin-account-actions] unhandled error:", String((err as Error)?.stack || err));
    return json({ error: `Server error: ${String((err as Error)?.message || err)}` }, 500);
  }
});
