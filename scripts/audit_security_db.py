#!/usr/bin/env python3
"""Task: Security & Performance audit — DB introspection via Supabase Management API.
Checks: RLS status per table, policies, indexes, table sizes, security-definer
functions without hardened search_path, exposed auth config, storage buckets.
"""
import json
import sys
import urllib.request

REF = "pbsythpzncjoafpmijyd"
TOKEN = open("/home/z/my-project/.secrets/supabase-access-token").read().strip()
BASE = f"https://api.supabase.com/v1/projects/{REF}"


def api(path, payload=None):
    url = f"{BASE}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if payload is not None else "GET")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"__error": e.code, "body": e.read().decode()[:500]}


def sql(q):
    return api("/database/query", {"query": q})


print("=" * 70)
print("1) RLS STATUS PER TABLE (public schema)")
print("=" * 70)
rows = sql("""
select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policy_count,
       (select n_live_tup from pg_stat_user_tables s where s.relid=c.oid) as rows
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
order by c.relrowsecurity asc, c.relname
""")
if isinstance(rows, dict) and rows.get("__error"):
    print("ERROR:", rows)
    sys.exit(1)
no_rls = [r for r in rows if not r["rls"]]
low_policy = [r for r in rows if r["rls"] and r["policy_count"] == 0]
print(f"{'table':<38} {'RLS':<5} {'policies':<9} {'rows':>8}")
for r in rows:
    flag = "  ⚠️ NO RLS" if not r["rls"] else ("  ⚠️ RLS but 0 policies" if r["policy_count"] == 0 else "")
    print(f"{r['table_name']:<38} {str(r['rls']):<5} {r['policy_count']:<9} {r['rows']:>8}{flag}")
print(f"\nSUMMARY: {len(rows)} tables, {len(no_rls)} without RLS, {len(low_policy)} with RLS but 0 policies")

print()
print("=" * 70)
print("2) PERMISSIVE/ALL policies that might be too broad (USING true)")
print("=" * 70)
broad = sql("""
select tablename, policyname, cmd, roles, permissive,
       left(qual, 120) as qual, left(with_check, 120) as with_check
from pg_policies
where schemaname='public' and (qual ilike '%true%' or with_check ilike '%true%')
order by tablename
""")
for p in broad:
    print(f"- {p['tablename']}.{p['policyname']} [{p['cmd']}] roles={p['roles']}\n    qual: {p['qual']}\n    with_check: {p['with_check']}")

print()
print("=" * 70)
print("3) TABLES WITH >0 ROWS BUT NO INDEX ON teacher_id-like FK (perf)")
print("=" * 70)
idx = sql("""
select t.relname as table_name,
       exists(select 1 from pg_indexes i where i.schemaname='public' and i.tablename=t.relname
              and (i.indexdef ilike '%teacher_id%' or i.indexdef ilike '%student_id%' or i.indexdef ilike '%group_id%')) as has_key_index,
       (select n_live_tup from pg_stat_user_tables s where s.relid=t.oid) as rows
from pg_class t join pg_namespace n on n.oid=t.relnamespace
join pg_attribute a on a.attrelid=t.oid and a.attname in ('teacher_id','student_id','group_id') and a.attnum>0
where n.nspname='public' and t.relkind='r'
group by t.oid, t.relname
order by rows desc
""")
for r in idx:
    if r["rows"] > 200 and not r["has_key_index"]:
        print(f"⚠️ {r['table_name']}: {r['rows']} rows, no index on teacher_id/student_id/group_id")

print()
print("=" * 70)
print("4) INDEXES ON BIGGEST TABLES (top 12 by rows)")
print("=" * 70)
big = sorted(rows, key=lambda r: -r["rows"])[:12]
for r in big:
    print(f"\n-- {r['table_name']} ({r['rows']} rows)")
    defs = sql(f"select indexname, indexdef from pg_indexes where schemaname='public' and tablename='{r['table_name']}'")
    for d in defs:
        print(f"   {d['indexdef'][:160]}")

print()
print("=" * 70)
print("5) SECURITY DEFINER FUNCTIONS WITHOUT hardened search_path")
print("=" * 70)
sd = sql("""
select p.proname, p.prosecdef,
       (select setting from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where s.setdatabase=0 and r.rolname='postgres' limit 1) as dummy,
       array_to_string(p.proconfig, ',') as config
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef=true
""")
bad_sd = [f for f in sd if "search_path" not in (f["config"] or "")]
print(f"total security-definer funcs: {len(sd)}, without pinned search_path: {len(bad_sd)}")
for f in bad_sd[:30]:
    print(f"  ⚠️ {f['proname']}")

print()
print("=" * 70)
print("6) PUBLIC portals / anon-reachable policies (anon role listed)")
print("=" * 70)
anon = sql("""
select tablename, policyname, cmd, left(qual,100) as qual
from pg_policies
where schemaname='public' and ('anon' = any(roles::text::jsonb) or roles::text ilike '%anon%')
order by tablename
""")
for p in anon:
    print(f"- {p['tablename']}.{p['policyname']} [{p['cmd']}] {p['qual']}")

print()
print("=" * 70)
print("7) AUTH CONFIG (rate limits / OTP expiry)")
print("=" * 70)
auth = api("/config/auth")
if isinstance(auth, dict) and not auth.get("__error"):
    for k in ("external_anonymous_users_enabled", "mailer_autoconfirm", "sms_autoconfirm",
              "mailRateLimits", "rate_limit_email_sent", "rate_limitotp_verify", "rate_limit_token_refresh",
              "jwt_expiry", "refresh_token_rotation_enabled", "refresh_token_reuse_interval",
              "password_min_length", "disable_signup"):
        if k in auth:
            print(f"  {k}: {auth[k]}")
else:
    print("  (config endpoint unavailable)", auth if isinstance(auth, dict) else "")

print()
print("8) STORAGE BUCKETS")
print("=" * 70)
buckets = sql("select name, public, file_size_limit, allowed_mime_types from storage.buckets order by name")
for b in buckets:
    print(f"  {b['name']:<24} public={b['public']} size_limit={b['file_size_limit']} mimes={b['allowed_mime_types']}")
