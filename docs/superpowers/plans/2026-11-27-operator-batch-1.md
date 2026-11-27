# Operator Batch #8 — Plan (icons finish, Supabase RLS+index, perf, browser proof)

**Goal:** finish the line-icon cleanup on the students page + QR modals, re-audit landing/pricing + students with frontend-design, verify Supabase RLS on students/payments + add an index on the QR/student code column, review dashboard/portal performance, then prove it all in a real browser with screenshots of the 4 card styles + students page. ONE final relay message with everything.

**Constraints (from #8):** no End-class or WhatsApp sends during tests; screenshots of card styles A, B, C, D + students page; everything deployed before reporting; use the 5 installed skills.

## Task a) Icon cleanup (finish note #9-1 sweep)
Conventions from `scripts/sweep_icons_9.py`: JSX glyph prefixes → `<Icon name size={15} style={{marginInlineEnd:6, verticalAlign:'-0.2em'}}/>`; string-literal emoji (toasts/titles/placeholders) stripped; code comments untouched.
- `icons.jsx`: add `archive` + `save` (Lucide geometry) — the only missing glyphs.
- `StudentsArea.jsx` — rows: 📦→archive, ⚠→alert-circle, ↩→rotate-ccw, ✆→phone, 🗑→trash; bulk bar: ♦→users, ⧉→copy, ▾→chevron-down, ⛶→smartphone, 🗑→trash, ✕→x; select-all ☑/☐→check-square/square; bulk-add modal: 🎉→sparkles, ☐→square, ✓→check, ⟲→rotate-ccw, ⧉→copy, ✕→x, ✓ validate→check, 💾→save; strip 🔍 from search placeholder; strip ✓ from success toasts.
- `StudentQRModal.jsx` — buttons: 📋/✓→copy/check, ✆→phone, ⬇→download; strip ✓ from toasts.
- Also same-pattern strays: AnalyticsArea 🥇🥈🥉→trophy+nth, 👌→plain text; HistoryArea 🔍 placeholder.
- Verify: emoji scan of touched files clean; lint; build.

## Task a2) frontend-design re-audit
Playwright screenshots (desktop 1280 + 390 mobile) of landing/pricing + students page; check against the skill (type hierarchy, spacing rhythm, restraint, focus states, no AI-tells). Targeted fixes only — the approved direction stays.

## Task b) Supabase RLS + index
- Read `skills/supabase-postgres-best-practices/references/security-*` + `query-missing-indexes.md`.
- Find project ref/credentials (Vercel env via token in `.secrets/vercel-token`, never printed).
- Inspect live RLS on `students`, `payments` (pg_policies) + existing indexes (pg_indexes) on the QR/student code column (`code`, qr token columns).
- Deliverable: migration SQL under `supabase/migrations/` + applied via psql if reachable; verify with fresh catalog queries. If DB unreachable, ship the migration file + exact apply steps and say so.

## Task c) Performance review
- `npm run build` → chunk sizes; flag heavy static imports (jspdf/docx/chart.js/animejs) → dynamic import where button-driven.
- Trace dashboard/portal data loading in `WorkspaceStore.jsx` for sequential awaits → parallelize independent ones (Promise.all).
- Re-render pass on dashboard/portal hot paths (no inline components, derive-don't-sync).
- Verify: build passes, browser smoke, bundle delta reported.

## Task d) Browser proof + ship
- Playwright: login (any email + ≥6-char password via the login form), students page, QR cards modal → screenshots of styles A/B/C/D + students page (desktop + 390 check).
- No End-class, no WhatsApp sends (no bulk messaging buttons touched).
- Commit → CI → Vercel live fingerprint check → ONE final relay message with plan summary, changes, screenshots, verification evidence.

**Review focus:** RTL text with new icons stays aligned; pills with icons keep vertical rhythm; 390px rows/bulk bar don't overflow; select-all aria text intact; no sends triggered by any test action.
