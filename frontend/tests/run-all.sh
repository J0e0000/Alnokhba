#!/usr/bin/env bash
# ============================================================================
# نظام النخبة — Test Runner
# ============================================================================
# Runs all automated tests for the data-isolation fix:
#   1. Syntax check — verifies all modified JSX/JS files parse correctly
#   2. Static isolation check — scans every frontend Supabase query and
#      asserts each tenant-table SELECT is scoped by teacher_id
#   3. Integration tests — simulates cross-tenant access with a mock
#      Supabase client that emulates the RLS policies
#
# Run with:  bash /home/z/my-project/audit/al-fares-saas/frontend/tests/run-all.sh
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "══════════════════════════════════════════════════════════════════"
echo " Test 1/4: Syntax check (babel parser)"
echo "══════════════════════════════════════════════════════════════════"
node tests/syntax-check.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " Test 2/4: Static isolation check (Supabase query scoping audit)"
echo "══════════════════════════════════════════════════════════════════"
node tests/static-isolation-check.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " Test 3/4: Integration tests (mock Supabase RLS simulation)"
echo "══════════════════════════════════════════════════════════════════"
node --test tests/isolation.test.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " Test 4/4: Backup edge-function self-diagnosis (Round 5)"
echo "══════════════════════════════════════════════════════════════════"
node tests/backup-edge-check.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " Test 5/5: Announcement Board (Round 6)"
echo "══════════════════════════════════════════════════════════════════"
node tests/announcement-board-check.cjs

echo ""
echo " Test 6/6: Instant sync + WhatsApp reliability (Round 7)"
node tests/realtime-sync-check.cjs
echo ""

echo " Test 7/7: Exam score editing — two independent operations (Round 8)"
node tests/exam-edit-check.cjs
echo ""

echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " All tests passed \u2713"
echo "══════════════════════════════════════════════════════════════════"
