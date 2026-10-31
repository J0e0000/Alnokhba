#!/usr/bin/env python3
"""Task 42: dry-run the retroactive auto-archive rule against production data.

Mirrors the client engine exactly:
- held lecture = completed OR session_date < today (local Cairo rule approximated
  by the DB session date vs current_date)
- last 2 held lectures per group
- student candidate = active, has group, explicitly 'غائب' (latest record) in BOTH
- marker guard = auto_archive_marker IS NULL (no prior archive/restore)
"""
import json
import sys
import urllib.request

PROJECT_REF = "pbsythpzncjoafpmijyd"
TOKEN_PATH = "/home/z/my-project/.secrets/supabase-access-token"

SQL = """
with held as (
  select id, group_name,
         row_number() over (partition by group_name order by session_date desc, started_at desc) rn
  from lesson_sessions
  where group_name is not null
    and (status = 'completed' or session_date < (current_date)::date)
),
last2 as (select group_name, id as lesson_id from held where rn <= 2),
latest_att as (
  select student_id, lesson_session_id, status from (
    select student_id, lesson_session_id, status,
           row_number() over (partition by student_id, lesson_session_id order by recorded_at desc) rn
    from attendance_records
  ) t where rn = 1
)
select
  (select count(*) from students where archived = false and group_name is not null
     and auto_archive_marker is null
     and (select count(*) from last2 l
          join latest_att a on a.lesson_session_id = l.lesson_id and a.student_id = students.id
          where l.group_name = students.group_name and a.status = 'غائب') = 2) as to_auto_archive,
  (select count(*) from students where group_name is not null
     and auto_archive_marker is null and archived = false) as active_with_group,
  (select count(distinct group_name) from last2) as groups_with_2_held
"""


def call_api(sql: str, token: str):
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main() -> int:
    token = open(TOKEN_PATH).read().strip()
    status, rows = call_api(SQL, token)
    if status not in (200, 201) or not rows:
        print(f"FAILED HTTP {status}: {rows}")
        return 1
    row = rows[0] if isinstance(rows[0], dict) else rows[0]
    print(json.dumps(row, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
