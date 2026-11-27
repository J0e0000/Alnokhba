#!/usr/bin/env python3
"""Operator note (b): RLS check on students + payments, index on the QR/student
code column.

Reads DATABASE_URL from /home/z/my-project/.env (value never printed).
Phase 1 (inspect): RLS flags, live policies, existing indexes, row counts.
Phase 2 (apply):   CREATE INDEX IF NOT EXISTS on students(code) — the exact
                   ask; idempotent and non-destructive.
Phase 3 (verify):  fresh catalog read + EXPLAIN of the canonical code lookup.
"""
import os
import sys

import psycopg2
import psycopg2.extras

def connect():
    url = None
    with open('/home/z/my-project/.env') as f:
        for line in f:
            line = line.strip()
            if line.startswith('DATABASE_URL='):
                url = line.split('=', 1)[1].strip().strip('"').strip("'")
    if not url:
        sys.exit('DATABASE_URL missing from .env')
    if 'sslmode=' not in url:
        url += ('&' if '?' in url else '?') + 'sslmode=require'
    return psycopg2.connect(url, connect_timeout=20)

conn = connect()
conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

def q(sql, args=None):
    cur.execute(sql, args)
    return cur.fetchall()

print('=== 1. RLS flags (relrowsecurity / relforcerowsecurity) ===')
for r in q("""select c.relname, c.relrowsecurity as rls_on, c.relforcerowsecurity as forced
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname in ('students','student_payments','student_qr_tokens')
              order by c.relname"""):
    print(f"  {r['relname']}: RLS={'ON' if r['rls_on'] else 'OFF'} force={bool(r['forced'])}")

print('=== 2. Live policies on the three tables ===')
for r in q("""select tablename, policyname, cmd, roles,
                     substr(coalesce(qual,'-'),1,70) as using_expr
              from pg_policies
              where schemaname='public' and tablename in ('students','student_payments','student_qr_tokens')
              order by tablename, policyname"""):
    print(f"  {r['tablename']}.{r['policyname']} [{r['cmd']}] roles={r['roles']} using={r['using_expr']}")

print('=== 3. Existing indexes on students / student_qr_tokens ===')
for r in q("""select tablename, indexdef from pg_indexes
              where schemaname='public' and tablename in ('students','student_qr_tokens')
              order by tablename, indexname"""):
    print(f"  {r['tablename']}: {r['indexdef']}")

print('=== 4. Row counts ===')
for t in ('students', 'student_payments', 'student_qr_tokens'):
    n = q(f'select count(*) as n from public.{t}')[0]['n']
    print(f"  {t}: {n} rows")

print('=== 5. EXPLAIN the canonical code lookup (BEFORE index) ===')
for r in q("explain (costs off) select id, name from public.students where code = 'F-0000'"):
    print(' ', r[0])

print('=== 6. APPLY: index on students(code) (idempotent) ===')
q('create index if not exists idx_students_code on public.students (code)')
print('  create index if not exists idx_students_code on public.students (code) — done')

print('=== 7. VERIFY: fresh catalog + EXPLAIN (AFTER) ===')
idx = q("select indexdef from pg_indexes where schemaname='public' and indexname='idx_students_code'")
print(' ', idx[0]['indexdef'] if idx else 'MISSING!')
for r in q("explain (costs off) select id, name from public.students where code = 'F-0000'"):
    print(' ', r[0])

print('=== 8. QR-token lookup path index (must already exist) ===')
tok = q("select indexdef from pg_indexes where schemaname='public' and tablename='student_qr_tokens' and indexdef like '%token%'")
for r in tok:
    print(' ', r['indexdef'])

cur.close()
conn.close()
print('DONE')
