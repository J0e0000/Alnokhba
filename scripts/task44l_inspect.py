#!/usr/bin/env python3
"""Task 44l — inspect profiles.phone coverage + renewal-related schema for
WhatsApp receipts (وصل تجديد على واتساب)."""
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
        print(label, json.dumps(q(sql), ensure_ascii=False)[:700], flush=True)
    except Exception as e:
        print(label, 'ERR', e, flush=True)

show('phone_coverage:', "select count(*) total, count(*) filter (where phone is not null and phone <> '') with_phone from profiles")
show('phone_samples:', "select full_name, phone from profiles where phone is not null and phone <> '' limit 5")
show('renewals_cols:', "select column_name from information_schema.columns where table_schema='public' and table_name='subscription_renewals' order by ordinal_position")
show('renewals_recent:', "select teacher_id, new_expires_at, plan_name, days_added, email_status, created_at from subscription_renewals order by created_at desc limit 3")
show('admin_teams_cols:', "select column_name from information_schema.columns where table_schema='public' and table_name='admin_teams' order by ordinal_position")
