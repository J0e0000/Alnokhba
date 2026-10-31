#!/usr/bin/env python3
"""Task 42: per-group breakdown — fixed aggregation."""
import json
import sys
import urllib.request

PROJECT_REF = "pbsythpzncjoafpmijyd"
TOKEN_PATH = "/home/z/my-project/.secrets/supabase-access-token"

SQL = """
with held as (
  select id, group_name, session_date,
         row_number() over (partition by group_name order by session_date desc, started_at desc) rn
  from lesson_sessions
  where group_name is not null
    and (status = 'completed' or session_date < (current_date)::date)
),
last2 as (select group_name, id as lesson_id, session_date from held where rn <= 2),
latest_att as (
  select student_id, lesson_session_id, status from (
    select student_id, lesson_session_id, status,
           row_number() over (partition by student_id, lesson_session_id order by recorded_at desc) rn
    from attendance_records
  ) t where rn = 1
),
per_student as (
  select s.id, s.group_name,
         count(*) filter (where a.status = 'غائب') as absent_in_pair
  from students s
  join last2 l on l.group_name = s.group_name
  left join latest_att a on a.lesson_session_id = l.lesson_id and a.student_id = s.id
  where s.archived = false and s.auto_archive_marker is null
  group by s.id, s.group_name
)
select
  ps.group_name,
  max(l2.session_date)::text as last_held_date,
  count(*) filter (where ps.absent_in_pair = 2) as candidates,
  count(*) as active_students
from per_student ps
join last2 l2 on l2.group_name = ps.group_name
group by ps.group_name
having count(*) filter (where ps.absent_in_pair = 2) > 0
order by candidates desc
limit 15
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
    if status not in (200, 201):
        print(f"FAILED HTTP {status}: {rows}")
        return 1
    for row in rows:
        print(json.dumps(row, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
