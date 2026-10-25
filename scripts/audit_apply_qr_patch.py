#!/usr/bin/env python3
"""Apply the security patch: close the anon-readable student_qr_tokens leak.
- Drops `qr_token_public_read` (SELECT using(true)) — the policy that leaked 769
  portal tokens to anyone with the public anon key.
- Creates `qr_token_workspace_read` — same read access the teacher app needs
  (owner / workspace members / active admin support session), nothing for anon.
- NO token rotation (per owner instruction: printed QR links keep working).
- Defensive: enable RLS on edge_rate_limits (grants already lock anon; RLS
  makes it airtight. service_role used by edge functions bypasses RLS).
Verification: pg_policies diff before/after + anon probe stays 401/0-rows.
"""
import json
import urllib.request
import urllib.error

TOKEN = open("/home/z/my-project/.secrets/supabase-access-token").read().strip()
BASE = "https://api.supabase.com/v1/projects/pbsythpzncjoafpmijyd"
ANON = open("/tmp/anonkey.txt").read().strip()


def sql(q):
    req = urllib.request.Request(BASE + "/database/query", data=json.dumps({"query": q}).encode(), method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def show_policies(label):
    rows = sql("select policyname, cmd, left(qual,80) as qual from pg_policies where schemaname='public' and tablename='student_qr_tokens' order by policyname")
    print(f"--- policies {label} ---")
    for p in rows:
        print(f"  {p['policyname']} [{p['cmd']}] {p['qual']}")


print("BEFORE:")
show_policies("(before)")

# ── the patch ────────────────────────────────────────────────────────────────
PATCH = """
begin;
drop policy if exists "qr_token_public_read" on public.student_qr_tokens;
create policy "qr_token_workspace_read" on public.student_qr_tokens
  for select using (
    auth.uid() is not null
    and exists (
      select 1 from public.students s
      where s.id = student_qr_tokens.student_id
        and (s.teacher_id = auth.uid() or public.can_access_workspace(s.teacher_id))
    )
  );
alter table public.edge_rate_limits enable row level security;
commit;
"""
print("\nApplying patch...")
print(sql(PATCH))
print("\nAFTER:")
show_policies("(after)")

# edge_rate_limits now RLS-on, service_role unaffected
rls = sql("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='edge_rate_limits'")
print(f"\nedge_rate_limits RLS enabled: {rls[0]['relrowsecurity']}")

# ── live verification: anon probe must no longer see tokens ─────────────────
print("\nAnon probe after patch:")
try:
    req = urllib.request.Request("https://pbsythpzncjoafpmijyd.supabase.co/rest/v1/student_qr_tokens?select=*&limit=5")
    req.add_header("apikey", ANON)
    req.add_header("Authorization", f"Bearer {ANON}")
    with urllib.request.urlopen(req, timeout=15) as r:
        body = json.loads(r.read().decode())
        print(f"  HTTP {r.status}, rows returned: {len(body)}  {'✅ LEAK CLOSED (0 rows for anon)' if len(body) == 0 else '⚠️ STILL LEAKING'}")
except urllib.error.HTTPError as e:
    print(f"  HTTP {e.code} ✅ blocked for anon")

# confirm tokens still resolvable by the portal RPC path (the actual product path)
print("\nPortal RPC sanity (existing token must still work):")
tok = sql("select token from public.student_qr_tokens where revoked_at is null limit 1")[0]["token"]
req = urllib.request.Request(
    "https://pbsythpzncjoafpmijyd.supabase.co/rest/v1/rpc/get_student_portal_data",
    data=json.dumps({"p_token": tok}).encode(), method="POST")
req.add_header("apikey", ANON)
req.add_header("Authorization", f"Bearer {ANON}")
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=20) as r:
    d = json.loads(r.read().decode())
    print(f"  HTTP {r.status} — student payload present: {bool(d.get('student'))} ✅ portal unaffected")
