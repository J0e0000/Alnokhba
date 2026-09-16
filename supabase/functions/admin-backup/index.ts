// ============================================================================
// Alnokhba — Edge Function: admin-backup
// ============================================================================
// Backup & Recovery system server-side worker.
//
//   Actions (POST JSON):
//     { action: 'create' }                          → manual backup (Admin JWT)
//     { action: 'scheduled', backupId }             → scheduler dispatch (validated row)
//     { action: 'retry', backupId }                 → manual retry of FAILED backup (Admin JWT)
//     { action: 'download-url', backupId }          → 60-min signed URL (Admin JWT)
//     { action: 'restore-preview', backupId }       → parse + conflict report (Admin JWT)
//     { action: 'restore', backupId, teacherId,
//       blocks: [...], strategy: 'skip'|'overwrite' } → selective restore (Admin JWT)
//
//   Security:
//     • Admin actions verify the caller's own JWT and profiles.is_admin server-side.
//     • The scheduled path only accepts backup rows the DB scheduler itself created.
//     • All DB mutations go through security-definer RPCs that re-check authorization.
//     • Backup files live in the PRIVATE `admin-backups` bucket; downloads require
//       a signed URL minted here, only for admins.
//     • NO passwords, hashes, tokens or keys are ever exported.
// ============================================================================

import * as XLSX from "npm:xlsx@0.18.5"
import { createClient } from "npm:@supabase/supabase-js@2"

const BUCKET = "admin-backups"
const CAIRO_TZ = "Africa/Cairo"
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const SYSTEM_VERSION = "Alnokhba V1"
const MAX_INTERNAL_ATTEMPTS = 3

// Per-teacher data tables exported into each Teacher_XXX sheet and eligible
// for selective restore. teacherCol null → grouped via the student's teacher.
const TEACHER_TABLES: Array<{ table: string; teacherCol: string | null }> = [
  { table: "groups", teacherCol: "teacher_id" },
  { table: "lesson_sessions", teacherCol: "teacher_id" },
  { table: "students", teacherCol: "teacher_id" },
  { table: "attendance_records", teacherCol: "teacher_id" },
  { table: "behavior_logs", teacherCol: "teacher_id" },
  { table: "homework_tasks", teacherCol: "teacher_id" },
  { table: "student_payments", teacherCol: "teacher_id" },
  { table: "announcements", teacherCol: "teacher_id" },
  { table: "exams", teacherCol: "teacher_id" },
  { table: "exam_scores", teacherCol: "teacher_id" },
  { table: "student_notifications", teacherCol: "teacher_id" },
  { table: "report_templates", teacherCol: "teacher_id" },
  { table: "group_schedule", teacherCol: "teacher_id" },
  { table: "session_logs", teacherCol: "teacher_id" },
  { table: "feature_unlocks", teacherCol: "teacher_id" },
  { table: "qb_questions", teacherCol: "teacher_id" },
  { table: "qb_exams", teacherCol: "teacher_id" },
  { table: "student_qr_tokens", teacherCol: null },
  { table: "teacher_settings", teacherCol: "teacher_id" },
]

// Whitelist used by the restore path — MUST match admin_restore_apply in SQL.
const RESTORE_TABLES = [
  "groups", "lesson_sessions", "students", "attendance_records", "behavior_logs",
  "homework_tasks", "student_payments", "announcements", "exams", "exam_scores",
  "student_notifications", "student_qr_tokens", "report_templates", "group_schedule",
  "session_logs", "feature_unlocks", "qb_questions", "qb_exams", "teacher_settings",
]

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function waitUntil(promise: Promise<unknown>) {
  const runtime = (globalThis as Record<string, unknown>).EdgeRuntime
  if (runtime && typeof (runtime as Record<string, unknown>).waitUntil === "function") {
    ;(runtime as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(promise)
  }
}

function cairoStamp(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}`
}

async function sha256Hex(buf: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function cellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === "object") return JSON.stringify(value)
  if (typeof value === "string") return value.length > 32000 ? value.slice(0, 32000) : value
  return value as string | number | boolean
}

// ============================================================================

async function fetchAll(service: ReturnType<typeof createClient>, table: string) {
  const { data, error } = await service.from(table).select("*").limit(50000)
  if (error) throw new Error(`${table}: ${error.message}`)
  return data ?? []
}

interface BackupData {
  profiles: Array<Record<string, unknown>>
  tableData: Record<string, Array<Record<string, unknown>>>
  dbInfo: Record<string, unknown>
  warnings: string[]
}

async function collectAllData(service: ReturnType<typeof createClient>): Promise<BackupData> {
  const warnings: string[] = []
  const profiles = await fetchAll(service, "profiles")

  const tableData: Record<string, Array<Record<string, unknown>>> = {}
  for (const def of TEACHER_TABLES) {
    try {
      tableData[def.table] = await fetchAll(service, def.table)
    } catch (err) {
      // Partial backup: a missing/locked optional table must not kill the job.
      warnings.push(String((err as Error)?.message || err))
      tableData[def.table] = []
    }
  }
  for (const table of ["admin_teams", "admin_team_members", "workspace_members", "broadcast_messages", "backup_settings"]) {
    try {
      tableData[table] = await fetchAll(service, table)
    } catch (err) {
      warnings.push(String((err as Error)?.message || err))
      tableData[table] = []
    }
  }

  let dbInfo: Record<string, unknown> = {}
  try {
    const { data } = await service.rpc("admin_db_info")
    dbInfo = (data as Record<string, unknown>) ?? {}
  } catch { /* best-effort */ }

  return { profiles, tableData, dbInfo, warnings }
}

function groupByTeacher(def: { table: string; teacherCol: string | null }, rows: Array<Record<string, unknown>>, studentTeacher: Map<string, string>) {
  const map = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    let teacherId: string | null = null
    if (def.teacherCol) teacherId = (row[def.teacherCol] as string) ?? null
    else if (def.table === "student_qr_tokens") {
      teacherId = studentTeacher.get(String(row.student_id)) ?? null
    }
    if (!teacherId) continue
    if (!map.has(teacherId)) map.set(teacherId, [])
    map.get(teacherId)!.push(row)
  }
  return map
}

function buildWorkbook(data: BackupData, backupId: string, backupType: string) {
  const { profiles, tableData, dbInfo, warnings } = data

  const students = tableData["students"] ?? []
  const studentTeacher = new Map<string, string>()
  for (const s of students) if (s.teacher_id) studentTeacher.set(String(s.id), String(s.teacher_id))

  const grouped = new Map<string, Map<string, Array<Record<string, unknown>>>>()
  for (const def of TEACHER_TABLES) {
    grouped.set(def.table, groupByTeacher(def, tableData[def.table] ?? [], studentTeacher))
  }

  const recordsCount = Object.entries(tableData)
    .filter(([t]) => RESTORE_TABLES.includes(t))
    .reduce((sum, [, rows]) => sum + rows.length, 0)

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Backup Info ──
  const stamp = cairoStamp()
  const [datePart, timePart] = stamp.split("_")
  const infoRows: Array<Array<string | number>> = [
    ["البند", "القيمة"],
    ["معرّف النسخة (Backup ID)", backupId],
    ["تاريخ النسخة (Backup date)", datePart],
    ["وقت النسخة (Backup time)", timePart],
    ["المنطقة الزمنية (Timezone)", CAIRO_TZ],
    ["إصدار النظام (System version)", SYSTEM_VERSION],
    ["إصدار قاعدة البيانات (DB version)", String(dbInfo.postgres_version ?? "—")],
    ["عدد المستخدمين (Users)", profiles.length],
    ["عدد الفرق (Teams)", (tableData["admin_teams"] ?? []).length],
    ["عدد الطلاب (Students)", students.length],
    ["عدد السجلات (Records)", recordsCount],
    ["حالة النسخة (Backup status)", "SUCCESS"],
    ["نوع النسخة (Backup type)", backupType],
    ["طابع الإنشاء (Timestamp)", new Date().toISOString()],
  ]
  if (warnings.length) infoRows.push(["تحذيرات (Warnings)", warnings.join(" | ").slice(0, 1000)])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(infoRows), "Backup Info")

  // ── Sheet 2: All Users (NO passwords/hashes/secrets by design) ──
  const userHeaders = ["id", "full_name", "email", "phone", "account_type", "subscription_status", "subscription_expires_at", "is_verified", "is_admin", "created_at"]
  const userRows = profiles.map((p) => userHeaders.map((h) => cellValue(p[h])))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([userHeaders, ...userRows]), "All Users")

  // ── Sheet 3: Teams ──
  const teamsAoa: Array<Array<string | number | null>> = []
  for (const table of ["admin_teams", "admin_team_members"]) {
    const rows = tableData[table] ?? []
    teamsAoa.push([`##TABLE:${table}`, `عدد الصفوف: ${rows.length}`])
    if (rows.length) {
      const headers = Object.keys(rows[0])
      teamsAoa.push(headers)
      for (const r of rows) teamsAoa.push(headers.map((h) => cellValue(r[h])))
    }
    teamsAoa.push([])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teamsAoa), "Teams")

  // ── Sheet 4: Platform ──
  const platformAoa: Array<Array<string | number | null>> = []
  for (const table of ["workspace_members", "broadcast_messages", "backup_settings"]) {
    const rows = tableData[table] ?? []
    platformAoa.push([`##TABLE:${table}`, `عدد الصفوف: ${rows.length}`])
    if (rows.length) {
      const headers = Object.keys(rows[0])
      platformAoa.push(headers)
      for (const r of rows) platformAoa.push(headers.map((h) => cellValue(r[h])))
    }
    platformAoa.push([])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(platformAoa), "Platform")

  // ── One sheet per user: Teacher_001, Teacher_002, ... ──
  profiles.forEach((profile, index) => {
    const sheetName = `Teacher_${String(index + 1).padStart(3, "0")}`
    const aoa: Array<Array<string | number | boolean | null>> = [
      ["معلومات الحساب (Account Info)"],
      ["الاسم", String(profile.full_name ?? "")],
      ["المعرّف (ID)", String(profile.id ?? "")],
      ["البريد الإلكتروني", String(profile.email ?? "")],
      ["الهاتف", String(profile.phone ?? "")],
      ["نوع الحساب", String(profile.account_type ?? "")],
      [],
    ]
    for (const def of TEACHER_TABLES) {
      const rows = grouped.get(def.table)?.get(String(profile.id)) ?? []
      aoa.push([`##TABLE:${def.table}`, `عدد الصفوف: ${rows.length}`])
      if (rows.length) {
        const headers = Object.keys(rows[0])
        aoa.push(headers)
        for (const r of rows) aoa.push(headers.map((h) => cellValue(r[h])))
      }
      aoa.push([])
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName)
  })

  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  return {
    buffer,
    fileName: `Alnokhba_Backup_${stamp}.xlsx`,
    stats: {
      users: profiles.length,
      teams: (tableData["admin_teams"] ?? []).length,
      students: students.length,
      records: recordsCount,
      sheets: wb.SheetNames.length,
      warnings,
    },
  }
}

// ============================================================================

async function setStage(service: ReturnType<typeof createClient>, backupId: string, stage: string) {
  try {
    await service.from("backups").update({ metadata: { stage, stage_at: new Date().toISOString() } }).eq("id", backupId)
  } catch { /* best-effort progress hint */ }
}

async function runBackup(
  service: ReturnType<typeof createClient>,
  caller: ReturnType<typeof createClient>,
  backupId: string,
  backupType: string,
) {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= MAX_INTERNAL_ATTEMPTS; attempt++) {
    try {
      await setStage(service, backupId, attempt > 1 ? `retry_${attempt}` : "collecting")
      const data = await collectAllData(service)

      await setStage(service, backupId, "generating")
      const { buffer, fileName, stats } = buildWorkbook(data, backupId, backupType)

      await setStage(service, backupId, "uploading")
      const path = fileName
      const { error: uploadError } = await service.storage
        .from(BUCKET)
        .upload(path, new Uint8Array(buffer), { contentType: XLSX_MIME, upsert: true })
      if (uploadError) throw new Error(`upload: ${uploadError.message}`)

      await setStage(service, backupId, "verifying")
      const { data: blob, error: downloadError } = await service.storage.from(BUCKET).download(path)
      if (downloadError || !blob) throw new Error(`verify-download: ${downloadError?.message ?? "no file"}`)
      const verifyBuf = new Uint8Array(await (blob as Blob).arrayBuffer())
      const wbCheck = XLSX.read(verifyBuf, { type: "array" })
      if (!wbCheck.SheetNames.includes("Backup Info")) throw new Error("verify: Backup Info sheet missing")
      if (!wbCheck.SheetNames.includes("All Users")) throw new Error("verify: All Users sheet missing")
      const usersSheet = XLSX.utils.sheet_to_json(wbCheck.Sheets["All Users"]) as Array<Record<string, unknown>>
      if (usersSheet.length !== stats.users) {
        throw new Error(`verify: users count mismatch (${usersSheet.length} <> ${stats.users})`)
      }
      const checksum = await sha256Hex(verifyBuf)

      await setStage(service, backupId, "completing")
      const { error: completeError } = await caller.rpc("admin_backup_complete", {
        p_backup_id: backupId,
        p_file_name: fileName,
        p_file_path: path,
        p_file_size: verifyBuf.length,
        p_checksum: checksum,
        p_sheet_count: stats.sheets,
        p_users_count: stats.users,
        p_teams_count: stats.teams,
        p_students_count: stats.students,
        p_records_count: stats.records,
        p_partial: stats.warnings.length > 0,
        p_metadata: {
          stage: "done",
          system_version: SYSTEM_VERSION,
          db_info: data.dbInfo,
          warnings: stats.warnings.slice(0, 20),
          verified: true,
        },
      })
      if (completeError) throw new Error(`complete: ${completeError.message}`)
      return
    } catch (err) {
      lastError = err
      if (attempt < MAX_INTERNAL_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000))
    }
  }
  try {
    await caller.rpc("admin_backup_fail", {
      p_backup_id: backupId,
      p_error: String((lastError as Error)?.message || lastError).slice(0, 480),
    })
  } catch (err) {
    console.error("admin_backup_fail rpc failed:", err)
  }
}

// ============================================================================
// Restore helpers
// ============================================================================

function parseSheetBlocks(ws: XLSX.WorkSheet) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as Array<Array<unknown>>
  const blocks: Record<string, { headers: string[]; rows: Array<Record<string, unknown>> }> = {}
  let current: string | null = null
  for (const row of aoa) {
    if (!row || row.every((c) => c === null || c === "")) { current = null; continue }
    const first = String(row[0] ?? "")
    if (first.startsWith("##TABLE:")) {
      current = first.slice(8).trim()
      if (!RESTORE_TABLES.includes(current)) { current = null; continue }
      blocks[current] = { headers: [], rows: [] }
      continue
    }
    if (current && blocks[current]) {
      const block = blocks[current]
      if (block.headers.length === 0) {
        block.headers = row.map((h) => String(h ?? ""))
        continue
      }
      const obj: Record<string, unknown> = {}
      block.headers.forEach((h, i) => { obj[h] = row[i] === undefined ? null : row[i] })
      block.rows.push(obj)
    }
  }
  return blocks
}

function parseTeacherInfo(ws: XLSX.WorkSheet) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as Array<Array<unknown>>
  const info: Record<string, string> = {}
  for (const row of aoa) {
    if (!row) continue
    const first = String(row[0] ?? "")
    if (first.startsWith("##TABLE:")) break
    if (row.length >= 2 && first) info[first] = String(row[1] ?? "")
  }
  return info
}

// xlsx stores objects/arrays as JSON strings — parse them back for jsonb columns
function reviveJsonishStrings(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && v.length > 1 && (v.startsWith("{") || v.startsWith("["))) {
      try { out[k] = JSON.parse(v) } catch { out[k] = v }
    } else out[k] = v
  }
  return out
}

function normalizeForCompare(row: Record<string, unknown>) {
  const revived = reviveJsonishStrings(row)
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(revived).sort()) sorted[k] = revived[k]
  return JSON.stringify(sorted)
}

async function readBackupWorkbook(service: ReturnType<typeof createClient>, backupId: string) {
  const { data: row, error } = await service.from("backups").select("*").eq("id", backupId).maybeSingle()
  if (error || !row) throw new Error("النسخة الاحتياطية غير موجودة")
  if (!["SUCCESS", "PARTIAL"].includes(row.status)) throw new Error("هذه النسخة غير مكتملة — لا يمكن استخدامها للاستعادة")
  if (!row.file_path) throw new Error("ملف النسخة غير موجود")
  const { data: blob, error: dlError } = await service.storage.from(BUCKET).download(row.file_path)
  if (dlError || !blob) throw new Error("تعذر تحميل ملف النسخة من التخزين")
  const buf = new Uint8Array(await (blob as Blob).arrayBuffer())
  const wb = XLSX.read(buf, { type: "array" })
  return { row, wb }
}

function findTeacherSheet(wb: XLSX.WorkBook, teacherId: string): { name: string; ws: XLSX.WorkSheet; info: Record<string, string> } | null {
  for (const name of wb.SheetNames) {
    if (!/^Teacher_\d+$/.test(name)) continue
    const ws = wb.Sheets[name]
    const info = parseTeacherInfo(ws)
    if (info["المعرّف (ID)"] === teacherId) return { name, ws, info }
  }
  return null
}

// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const url = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500)

  const service = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ error: "Invalid JSON" }, 400) }
  const action = String(body.action || "")

  // ---- Resolve admin (server-side profile check — never trust client claims) ----
  const authorization = req.headers.get("Authorization")
  let admin: { id: string; client: ReturnType<typeof createClient> } | null = null
  if (authorization) {
    try {
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
      const { data: { user }, error: userError } = await caller.auth.getUser()
      if (!userError && user) {
        const { data: profile } = await service.from("profiles").select("id, is_admin").eq("id", user.id).maybeSingle()
        if (profile?.is_admin) admin = { id: user.id, client: caller }
      }
    } catch { /* fall through as anonymous */ }
  }

  try {
    // =====================================================================
    // Scheduled dispatch (from pg_cron → pg_net). Only accepts PENDING
    // weekly rows that the DB scheduler itself created.
    // =====================================================================
    if (action === "scheduled") {
      const backupId = String(body.backupId || "")
      if (!backupId) return json({ error: "backupId is required" }, 400)
      const { data: row, error } = await service.from("backups").select("id, status, backup_type").eq("id", backupId).maybeSingle()
      if (error || !row) return json({ error: "backup not found" }, 404)
      if (row.backup_type !== "weekly") return json({ error: "not a scheduled backup" }, 403)
      if (row.status !== "PENDING") return json({ ok: true, note: "already processed" })

      const { data: began, error: beginError } = await service.rpc("admin_backup_begin", { p_backup_id: backupId })
      if (beginError) return json({ error: beginError.message }, 500)
      if (!began) return json({ ok: true, note: "another job is running" })

      waitUntil(runBackup(service, service, backupId, "weekly"))
      return json({ ok: true, dispatched: true, backupId })
    }

    // =====================================================================
    // Manual backup now (Admin)
    // =====================================================================
    if (action === "create" || action === "retry") {
      if (!admin) return json({ error: "Admin access required" }, 403)

      let backupId: string | null = body.backupId ? String(body.backupId) : null

      if (action === "retry") {
        if (!backupId) return json({ error: "backupId is required" }, 400)
        const { error: resetError } = await admin.client.rpc("admin_backup_reset_for_retry", { p_backup_id: backupId })
        if (resetError) return json({ error: resetError.message }, 400)
      } else {
        const { data: row, error: insertError } = await service
          .from("backups")
          .insert({ backup_type: "manual", status: "PENDING", created_by: admin.id })
          .select("id")
          .single()
        if (insertError || !row) return json({ error: insertError?.message ?? "insert failed" }, 500)
        backupId = row.id
      }

      const { data: began, error: beginError } = await admin.client.rpc("admin_backup_begin", { p_backup_id: backupId })
      if (beginError) return json({ error: beginError.message }, 500)
      if (!began) {
        return json({ error: "backup_already_running", message: "هناك نسخة أخرى قيد التنفيذ — انتظر اكتمالها" }, 409)
      }

      waitUntil(runBackup(service, admin.client, backupId, "manual"))
      return json({ ok: true, dispatched: true, backupId })
    }

    // =====================================================================
    // Signed download URL (Admin)
    // =====================================================================
    if (action === "download-url") {
      if (!admin) return json({ error: "Admin access required" }, 403)
      const backupId = String(body.backupId || "")
      if (!backupId) return json({ error: "backupId is required" }, 400)
      const { data: row, error } = await service.from("backups").select("id, status, file_path, file_name").eq("id", backupId).maybeSingle()
      if (error || !row) return json({ error: "backup not found" }, 404)
      if (!["SUCCESS", "PARTIAL"].includes(row.status) || !row.file_path) {
        return json({ error: "هذه النسخة غير متاحة للتنزيل" }, 400)
      }
      const { data: signed, error: signError } = await service.storage.from(BUCKET).createSignedUrl(row.file_path, 3600, { download: row.file_name ?? undefined })
      if (signError || !signed) return json({ error: signError?.message ?? "signing failed" }, 500)
      return json({ ok: true, url: signed.signedUrl, expiresIn: 3600 })
    }

    // =====================================================================
    // Restore preview (Admin): sheet overview + per-table conflict report
    // =====================================================================
    if (action === "restore-preview") {
      if (!admin) return json({ error: "Admin access required" }, 403)
      const backupId = String(body.backupId || "")
      const teacherId = String(body.teacherId || "")
      if (!backupId) return json({ error: "backupId is required" }, 400)

      const { row, wb } = await readBackupWorkbook(service, backupId)

      const teachers: Array<Record<string, unknown>> = []
      for (const name of wb.SheetNames) {
        if (!/^Teacher_\d+$/.test(name)) continue
        const info = parseTeacherInfo(wb.Sheets[name])
        const blocks = parseSheetBlocks(wb.Sheets[name])
        const blockSummary = Object.entries(blocks).map(([table, b]) => ({ table, rowCount: b.rows.length }))
          .filter((b) => b.rowCount > 0)
        teachers.push({
          id: info["المعرّف (ID)"] ?? "",
          name: info["الاسم"] ?? "",
          sheet: name,
          blocks: blockSummary,
        })
      }

      let conflicts: Record<string, unknown> | null = null
      if (teacherId) {
        const sheet = findTeacherSheet(wb, teacherId)
        if (!sheet) return json({ error: "لا يوجد مستخدم بهذا المعرف داخل النسخة" }, 404)
        const blocks = parseSheetBlocks(sheet.ws)
        const report: Record<string, Record<string, unknown>> = {}
        for (const [table, block] of Object.entries(blocks)) {
          if (!block.rows.length) continue
          const live = await fetchAll(service, table)
          const byId = new Map<string, Record<string, unknown>>()
          for (const r of live) {
            const key = r.id ? String(r.id) : `t:${r.teacher_id}`
            byId.set(key, r)
          }
          let same = 0, changed = 0, fresh = 0
          const changedIds: string[] = []
          for (const brow of block.rows) {
            const key = brow.id ? String(brow.id) : `t:${brow.teacher_id}`
            const lrow = byId.get(key)
            if (!lrow) fresh++
            else if (normalizeForCompare(lrow as Record<string, unknown>) === normalizeForCompare(brow)) same++
            else { changed++; if (changedIds.length < 25) changedIds.push(key) }
          }
          report[table] = { backupRows: block.rows.length, same, changed, new: fresh, changedIds }
        }
        conflicts = report
      }

      return json({
        ok: true,
        backup: {
          id: row.id, file_name: row.file_name, created_at: row.created_at,
          status: row.status, users_count: row.users_count, checksum: row.checksum,
        },
        teachers,
        conflicts,
      })
    }

    // =====================================================================
    // Restore apply (Admin): selective, insert/update only, never deletes
    // =====================================================================
    if (action === "restore") {
      if (!admin) return json({ error: "Admin access required" }, 403)
      const backupId = String(body.backupId || "")
      const teacherId = String(body.teacherId || "")
      const strategy = body.strategy === "overwrite" ? "overwrite" : "skip"
      const blocks: string[] = Array.isArray(body.blocks) ? body.blocks.map(String).filter((b) => RESTORE_TABLES.includes(b)) : []
      if (!backupId || !teacherId) return json({ error: "backupId و teacherId مطلوبان" }, 400)

      const { wb } = await readBackupWorkbook(service, backupId)
      const sheet = findTeacherSheet(wb, teacherId)
      if (!sheet) return json({ error: "لا يوجد مستخدم بهذا المعرف داخل النسخة" }, 404)
      const parsed = parseSheetBlocks(sheet.ws)

      const rowsPayload: Record<string, Array<Record<string, unknown>>> = {}
      for (const table of blocks) {
        const block = parsed[table]
        if (block && block.rows.length) rowsPayload[table] = block.rows.map(reviveJsonishStrings)
      }
      if (!Object.keys(rowsPayload).length) return json({ error: "لا توجد بيانات مختارة للاستعادة" }, 400)

      const { data: result, error: rpcError } = await admin.client.rpc("admin_restore_apply", {
        p_backup_id: backupId,
        p_teacher_id: teacherId,
        p_rows: rowsPayload,
        p_strategy: strategy,
      })
      if (rpcError) return json({ error: rpcError.message }, 500)
      return json({ ok: true, result })
    }

    return json({ error: "Unsupported action" }, 400)
  } catch (err) {
    console.error("admin-backup error:", err)
    // Detailed error goes to logs only — the client gets a safe message.
    return json({ error: "تعذر تنفيذ العملية. أعد المحاولة." }, 500)
  }
})
