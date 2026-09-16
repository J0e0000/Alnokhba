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

  let body: { action?: string; targetUserId?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const targetUserId = String(body.targetUserId || "").trim();
  if (!targetUserId) return json({ error: "targetUserId is required" }, 400);

  if (body.action === "confirm_account") {
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    const { error: profileUpdateError } = await admin.from("profiles").update({ is_verified: true }).eq("id", targetUserId);
    if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: targetUserId, action: "verify", details: "تأكيد الحساب من لوحة الأدمن" });
    return json({ ok: true, action: "confirm_account" });
  }

  if (body.action === "set_password") {
    const password = String(body.password || "");
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
    if (error) return json({ error: error.message }, 400);
    await admin.from("admin_activity_log").insert({ admin_id: user.id, target_teacher_id: targetUserId, action: "password_change", details: "تغيير كلمة المرور من لوحة الأدمن" });
    return json({ ok: true, action: "set_password" });
  }

  return json({ error: "Unsupported action" }, 400);
});
