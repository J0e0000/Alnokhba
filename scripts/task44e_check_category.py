#!/usr/bin/env python3
"""Task 44e — inspect student_notifications category check constraint."""
import json, urllib.request, urllib.error

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:400]}') from e

print('constraint:', q("select pg_get_constraintdef(oid) from pg_constraint where conname = 'student_notifications_category_check'"))
print('existing categories:', q('select category, count(*) from student_notifications group by category order by 2 desc limit 12'))
