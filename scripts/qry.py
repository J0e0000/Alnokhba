#!/usr/bin/env python3
"""Quick SQL runner against production Supabase Postgres (read-only default)."""
import os, sys, json, ssl
import psycopg2

DSN = None
for line in open('/home/z/my-project/.env', encoding='utf-8'):
    if line.startswith('DATABASE_URL='):
        DSN = line.split('=', 1)[1].strip().strip('"').strip("'")
if not DSN:
    raise SystemExit('no DATABASE_URL')

sql = sys.argv[1] if len(sys.argv) > 1 else 'select 1'
conn = psycopg2.connect(DSN, sslmode='require', connect_timeout=15)
cur = conn.cursor()
cur.execute(sql)
try:
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    out = [dict(zip(cols, [str(v)[:120] if v is not None else None for v in r])) for r in rows]
    print(json.dumps(out, ensure_ascii=False, indent=1))
except psycopg2.ProgrammingError:
    conn.commit()
    print('OK (no rows returned)')
cur.close(); conn.close()
