#!/usr/bin/env python3
"""Task 42: apply migration_053 (student archive columns) to production.

Reuses the proven Task 38 pattern: Supabase Management API SQL endpoint.
NOTE: success returns HTTP 201 (not 200).
"""
import json
import sys
import urllib.request

PROJECT_REF = "pbsythpzncjoafpmijyd"
SQL_PATH = "/home/z/my-project/supabase/migration_053_student_archive.sql"
TOKEN_PATH = "/home/z/my-project/.secrets/supabase-access-token"

EXPECTED_COLUMNS = {
    "archived": "boolean",
    "archived_at": "timestamp with time zone",
    "archived_reason": "text",
    "auto_archive_marker": "timestamp with time zone",
}


def call_api(sql: str, token: str):
    url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main() -> int:
    token = open(TOKEN_PATH).read().strip()
    sql = open(SQL_PATH).read()

    print("== 1) apply migration 053 ==")
    status, result = call_api(sql, token)
    if status not in (200, 201):
        print(f"FAILED HTTP {status}: {result}")
        return 1
    print(f"OK HTTP {status}: {result}")

    print("== 2) verify columns via information_schema ==")
    names = ",".join(f"'{c}'" for c in EXPECTED_COLUMNS)
    status, rows = call_api(
        "select column_name, data_type, is_nullable, column_default "
        f"from information_schema.columns "
        f"where table_schema='public' and table_name='students' "
        f"and column_name in ({names}) order by column_name",
        token,
    )
    if status not in (200, 201) or not isinstance(rows, list):
        print(f"VERIFY FAILED HTTP {status}: {rows}")
        return 1
    found = {}
    for row in rows:
        # Management API returns a list with one dict keyed by column name
        # in some shapes; handle both dict-per-row and single-dict shapes.
        if isinstance(row, dict) and "column_name" in row:
            found[row["column_name"]] = row
        else:
            for k, v in row.items():
                print(f"  raw: {k} = {v}")
    if not found and rows and isinstance(rows[0], dict):
        # single-dict shape: {"column_name": [...], ...} — unlikely; bail loudly
        print(f"UNEXPECTED SHAPE: {rows}")
        return 1
    ok = True
    for col, dtype in EXPECTED_COLUMNS.items():
        row = found.get(col)
        if not row:
            print(f"MISSING column: {col}")
            ok = False
        else:
            print(f"  {col}: {row.get('data_type')} nullable={row.get('is_nullable')} default={row.get('column_default')}")
            if dtype not in str(row.get("data_type", "")):
                print(f"  TYPE MISMATCH for {col}: expected {dtype}")
                ok = False
    if not ok:
        return 1

    print("== 3) verify index ==")
    status, rows = call_api(
        "select indexname from pg_indexes "
        "where schemaname='public' and tablename='students' and indexname='idx_students_teacher_archived'",
        token,
    )
    if status not in (200, 201) or not rows:
        print(f"INDEX MISSING (HTTP {status}): {rows}")
        return 1
    print(f"index OK: {rows}")

    print("== 4) sanity: archived defaults count ==")
    status, rows = call_api("select count(*) filter (where archived) as archived_count, count(*) as total from public.students", token)
    if status not in (200, 201):
        print(f"SANITY FAILED HTTP {status}: {rows}")
        return 1
    print(f"counts: {rows}")

    print("ALL CHECKS PASSED — migration 053 live on production.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
