#!/usr/bin/env python3
"""Task 44k — verify no DB-level uniqueness on students.phone (guardian phone
shared by siblings must be insertable)."""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def show(label, sql):
    try:
        print(label, json.dumps(q(sql), ensure_ascii=False)[:800], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('phone_indexes:', "select indexname, indexdef from pg_indexes where schemaname='public' and tablename='students' and indexdef ilike '%phone%'")
show('unique_constraints:', "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.students'::regclass and contype in ('u','p','e')")
show('triggers_on_students:', "select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.students'::regclass and not tgisinternal")
show('dupe_phone_reality:', "select phone, count(*) n from students where phone is not null and phone <> '' and archived_at is null group by phone having count(*) > 1 order by n desc limit 5")
