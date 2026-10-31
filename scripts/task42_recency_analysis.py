#!/usr/bin/env python3
"""Task 42: understand WHY 575 students qualify — recency distribution."""
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
newest as (
  select group_name, max(session_date) as newest_held, count(*) filter (where rn <= 2) as pair_size
  from held group by group_name
),
last2 as (select group_name, id as lesson_id, session_date from held where rn <= 2),
latest_att as (
  select student_id, lesson_session_id, status from (
    select student_id, lesson_session_id, status,
           row_number() over (partition by student_id, lesson_session_id order by recorded_at desc) rn
    from attendance_records
  ) t where rn = 1
),
cand as (
  select s.id, s.group_name, n.newest_held,
         (current_date - n.newest_held) as days_since_newest
  from students s
  join newest n on n.group_name = s.group_name
  where s.archived = false and s.auto_archive_marker is null
    and (select count(*) from last2 l
         join latest_att a on a.lesson_session_id = l.lesson_id and a.student_id = s.id
         where l.group_name = s.group_name and a.status = 'غائب') = 2
)
select
  coalesce(case
    when days_since_newest <= 7 then 'a) <= 7 days'
    when days_since_newest <= 30 then 'b) 8-30 days'
    when days_since_newest <= 60 then 'c) 31-60 days'
    else 'd) > 60 days' end, 'd) > 60 days') as bucket,
  count(*) as students,
  count(distinct group_name) as groups
from cand group by 1 order by 1
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
