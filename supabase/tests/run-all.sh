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
echo " Test 1/3: Syntax check (babel parser)"
echo "══════════════════════════════════════════════════════════════════"
node tests/syntax-check.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " Test 2/3: Static isolation check (Supabase query scoping audit)"
echo "══════════════════════════════════════════════════════════════════"
node tests/static-isolation-check.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " Test 3/3: Integration tests (mock Supabase RLS simulation)"
echo "══════════════════════════════════════════════════════════════════"
node --test tests/isolation.test.cjs
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo " All tests passed \u2713"
echo "══════════════════════════════════════════════════════════════════"
