// Alnokhba Edu — Deep Product Audit Report (docx generator)
// Recipe R1 (Pure Paragraph Left) + DS-1 Deep Sea palette, 3-section numbering.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, NumberFormat, SectionType, TableOfContents,
  PageBreak, BorderStyle, WidthType, ShadingType, TableLayoutType, VerticalAlign,
} = require("docx");
const fs = require("fs");

// ── palette DS-1 (Deep Sea) ────────────────────────────────────────────────
const P = {
  bg: "0B1C2C", primary: "16324A", accent: "529286",
  body: "1C2A3D", secondary: "5B6B7D", surface: "E8ECEB",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "16324A", headerText: "FFFFFF", accentLine: "529286", innerLine: "BECFCC", surface: "F0F4F3" },
};
const c = (h) => h.replace("#", "");
const noB = { style: BorderStyle.NONE, size: 0, color: "auto" };
const noBorders = { top: noB, bottom: noB, left: noB, right: noB };
const allNoBorders = { top: noB, bottom: noB, left: noB, right: noB, insideHorizontal: noB, insideVertical: noB };
const EN = { ascii: "Times New Roman", eastAsia: "Times New Roman" };

// ── cover helpers (from design-system.md) ─────────────────────────────────
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."\uFF0C\u3002\u3001\uFF1B\uFF1A\uFF01\uFF1F", ..."-_\u2014\u2013\u00B7/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  // English text: average glyph ~0.55 × pt × 20 twips
  const charWidth = (pt) => pt * 11;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLines(title, charsPerLine(minPt)); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const CP = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: CP.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: CP.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join(" "), size: 18, color: CP.accent, font: EN, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: CP.cover.titleColor, font: { ascii: "Arial", eastAsia: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: CP.cover.subtitleColor, font: { ascii: "Arial", eastAsia: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200, right: padR }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 22, color: CP.cover.metaColor, font: { ascii: "Arial", eastAsia: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: CP.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: CP.cover.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                                            " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: CP.cover.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: CP.bg }, borders: noBorders, verticalAlign: VerticalAlign.TOP, children })],
    })],
  })];
}

// ── body helpers ──────────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 160, line: 380, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 32, color: P.primary, font: EN })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120, line: 340, lineRule: "atLeast" },
    children: [new TextRun({ text, bold: true, size: 28, color: P.primary, font: EN })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: opts.after ?? 120 },
    children: [new TextRun({ text, size: 22, color: P.body, font: EN })],
  });
}
function bodyRuns(runs, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: opts.after ?? 120 },
    children: runs.map(r => new TextRun({ size: 22, color: P.body, font: EN, ...r })),
  });
}
function note(text) {
  return new Paragraph({
    spacing: { line: 312, after: 120 }, indent: { left: 300 },
    border: { left: { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 10 } },
    children: [new TextRun({ text, size: 20, color: P.secondary, italics: true, font: EN })],
  });
}
function cellPara(text, o = {}) {
  return new Paragraph({
    alignment: o.align || AlignmentType.LEFT, spacing: { line: 276, after: 20 },
    children: [new TextRun({ text: String(text), size: o.size || 18, bold: !!o.bold, color: o.color || P.body, font: EN })],
  });
}
function dataTable(widths, headerCells, rows, opts = {}) {
  const mk = (t, i, hdr) => new TableCell({
    width: { size: widths[i], type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: hdr ? P.table.headerBg : (opts.zebra ? P.table.surface : "FFFFFF") },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    verticalAlign: VerticalAlign.TOP,
    children: [cellPara(t, hdr ? { bold: true, color: P.table.headerText } : {})],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: P.table.accentLine },
      left: noB, right: noB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: P.table.innerLine },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: P.table.innerLine },
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headerCells.map((t, i) => mk(t, i, true)) }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => new TableCell({
          width: { size: widths[i], type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: ri % 2 === 1 ? P.table.surface : "FFFFFF" },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: [cellPara(t)],
        })),
      })),
    ],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true, spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 20, color: P.secondary, font: EN })],
  });
}

// ── content ───────────────────────────────────────────────────────────────
const exec = [
  h1("1. Executive Summary"),
  body("Alnokhba Edu is in materially better shape than a typical early-stage SaaS. The repository at commit 1b56834e (origin/main, deployed 2026-10-23) implements a coherent Arabic-first education-operations platform: session pipeline with attendance, QR, homework, exams and WhatsApp parent reporting, a token-based student/parent portal, an assistant-sharing model, a separate multi-tenant Centers product, weekly automated backups with a restore path, subscription lifecycle with pause-not-deleted semantics, and a mature public marketing site with build-time prerendering of 13 routes. Forty-plus documented feature tasks preceded this audit, and the codebase reflects that history: product invariants (SAVE does not FINISH a session, student history is read-only, server state is authoritative) are enforced in the store layer and hold under testing."),
  body("This audit combined four parallel reconnaissance passes (architecture, security, marketing/conversion, workflows/performance) with line-level re-verification of every high-severity claim before acting on it. That discipline mattered: two of the most alarming initial findings were corrected by direct source reading. The unauthenticated push endpoint (S1) is already mitigated by an in-function DB-row validation added in a prior hardening round, so it was downgraded rather than changed; the backup token export (S8) turned out to be required for disaster-recovery fidelity, so the false code comment was corrected instead of stripping the column. Neither was shipped as code, avoiding risk without reducing real security."),
  body("The audit shipped one production migration and one frontend deploy. Migration 054 closes a genuine cross-tenant financial IDOR (get_accounts_summary), adds student-ownership checks to the attendance and homework RPCs, makes QR-token revocation effective for legacy UUID portal links, hardens assistant binding against workspace hijacking, bounds the portal payload, and adds three hot-path indexes that the every-boot loadAll query was missing. All 11 post-apply checks passed against production. The frontend deploy (commit 1b56834e, 16 files, +703/−63) removes three marketing promises that the product does not keep (Excel import, expenses, multi-branch), fixes a real data-loss bug in offline exam-score entry, corrects a UTC/local date split that misdated lessons after midnight Cairo time, makes prerendered marketing content visible instantly instead of behind the boot splash, and bridges the marketing analytics funnel into PostHog. Lint is clean, the build is green, browser smoke tests passed with zero feature-related console errors, and every fix was verified live in production."),
];

const arch = [
  h1("2. Repository Architecture and Feature Inventory"),
  h2("2.1 Layout and canonicality"),
  body("The deploy repository (github.com/J0e0000/Alnokhba) holds the application under frontend/ and the database and edge functions under supabase/. The sandbox works canonically at the root (src/, public/) and mirrors into frontend/ at deploy time via the .deploy-wt worktree; the build chain is vite build, then a CSS compatibility pass, then build-time prerendering of 13 marketing routes. There is no CI system: quality gates are oxlint, the build chain, marker checks in the bundle, and scripted browser smokes. Legacy mirrors and working artifacts (alnokhba-push/, adwork/, download/) coexist in the sandbox and are not part of the deploy path. Three legacy source files (AnalyticsArea, InsightsArea, PreviewDashboard) and a handful of lib leftovers are never imported; they are inert but should eventually be deleted to reduce confusion."),
  h2("2.2 Routes, roles, and lifecycle"),
  body("Public surface: landing, features, solutions, pricing, resources with three guide articles, about, contact, trial, privacy, plus status pages and the /qr/:token student-parent portal. The authenticated app is a state-routed shell (home, session workspace, standalone exams) with lazily loaded areas (students, history, reports, settings). Roles are teacher-owner, assistant (bound via workspace_members with an owner-override rule), platform admin (is_admin, with a support-session impersonation flow that is authorized by DB session rows, time-capped, and audited), and students/parents who hold no accounts and access the portal through QR tokens. Subscription enforcement is dual: the frontend gate uses ownerProfile-or-profile subscription status and expiry, and the database re-checks is_subscription_active() in row-level security, so a stale frontend cannot bypass the server. Trial is 14 days from profile creation; expiry pauses access without deleting anything, enforced by migration 048 and the admin renewal flow."),
  h2("2.3 Data model and backend"),
  body("The schema spans 54 numbered migrations (002-053 plus the base schema) covering profiles, groups, students, attendance, lesson sessions, exams (session and standalone), payments, notifications, push infrastructure, portal tables, analytics, backups, audit logs, rate limits, and the centers multi-tenant family. Row-level security is enabled on every user-data table with workspace-scoped policies; the only intentional USING(true) policy is anonymous inserts into login_attempts, which is itself dead code (see findings). Three edge functions run on Supabase: admin-account-actions (JWT-verified, admin-checked, rate-limited), admin-backup (admin resolved server-side, private bucket, signed URLs, rate-limited), and send-push-notification (public by design because the DB trigger calls it without an Authorization header, hardened by DB-row validation). Weekly backups run via pg_cron on Fridays at 22:00 Cairo time; restore goes through a security-definer RPC with an audit trail."),
  h2("2.4 Verified-against-marketing feature matrix"),
  body("Ships and verified: WhatsApp reports with a resumable send queue and per-item editing; QR student/parent portal with realtime refresh; absence auto-archive with one-tap restore; weekly insights; weekly backups with restore; assistant accounts; audit logging; standalone exams with per-exam WhatsApp result sending; offline queue for attendance and homework. Advertised but absent: Excel import (removed from copy in this audit), expenses UI (removed), multi-branch management (qualified as roadmap), scoped assistant permissions (copy corrected), plan student-cap enforcement (admitted in code comments as a commitment rather than an enforced limit - acceptable since it is not sold as machine-enforced). A question-bank backend (qb_ tables) exists with no frontend; it is dormant rather than broken."),
];

const findings = [
  h1("3. Findings Ranked by Severity"),
  body("Each finding below was re-verified against source before acting. IDs carry through the rest of this report. Evidence cites file and line at the audited commit. Two findings were reclassified during verification and were deliberately NOT shipped as code changes; both are documented rather than silently dropped."),
  tableTitle("Table 3-1. Findings register (post-verification)"),
  dataTable(
    [8, 10, 24, 33, 25],
    ["ID", "Severity", "Area", "Evidence", "Action taken in this audit"],
    [
      ["S2", "P1 (fixed)", "Financial IDOR", "migration_023 get_accounts_summary: security definer, no auth.uid() check; any authenticated user could read any teacher revenue/expenses", "Migration 054: can_access_workspace guard; revoked from anon/public"],
      ["S7", "P2 (fixed)", "RPC integrity", "upsert_lesson_attendance/homework never verify the student belongs to the lesson teacher", "Migration 054: student_not_in_workspace guard"],
      ["S5", "P2 (fixed)", "Assistant binding", "link_assistant_by_email re-points any account into any workspace; one live member owns 29 students", "Migration 054: block accounts with own data; block stealing across owners"],
      ["S4", "P2 (fixed)", "Portal revocation", "UUID fallback in 3 portal RPCs bypassed revoked_at (fallback is load-bearing: 1069 of 1822 students have no token row)", "Migration 054: fallback blocked only when a revoked token exists"],
      ["S3", "P1 (fixed)", "Repo hygiene", ".secrets/ (5 credential files) tracked in local git, unpushed", "Untracked + gitignored; rotation still advised (see ch. 8)"],
      ["PF2", "P2 (fixed)", "Performance", "No indexes on exam_scores(teacher_id,...), attendance_records(teacher_id,recorded_at), behavior_logs(teacher_id,...); loadAll scans every boot", "Migration 054: three indexes created and verified"],
      ["W1", "P2 (fixed)", "Data loss", "WorkspaceStore.jsx saveStandaloneScore offline path toasted a sync promise and dropped the score on reload", "Offline path now queues an upsert (same shape as attendance)"],
      ["W2", "P3 (fixed)", "Correctness", "todayISO() was UTC-based; 00:00-02:00 Cairo window misdated lessons; archive engine already used local dates", "todayISO() now Cairo-local; session open and attendance smoke-tested"],
      ["M1", "P1 (fixed)", "Honesty", "LandingPage.jsx FAQ promised Excel import that does not exist", "Copy replaced with the real bulk-add flow"],
      ["M2", "P1 (fixed)", "Honesty", "Signup.jsx and PricingPage.jsx sold expenses tracking at the moment of signup", "Removed; replaced with the real auto-archive feature"],
      ["M3", "P1 (fixed)", "Honesty", "Pricing differentiated four plans on branch counts; no branch entity exists in the product", "Branch axis qualified with roadmap note on every pricing surface"],
      ["M8", "P2 (fixed)", "Performance/UX", "Boot splash covered prerendered marketing content until React mounted (~2.6MB bundle)", "index.html fast-path: splash hidden when #root already carries the page; /?auth= and ?diag= excluded"],
      ["M5", "P2 (fixed)", "Analytics", "Marketing track() wrote only to dataLayer/localStorage; conversion funnel invisible to PostHog", "Bridge to PostHog client with a 200-event backlog drain"],
      ["M6", "P2 (fixed)", "Honesty", "llms.txt claimed 30-day retention (contradicts pause-never-delete) and English marketing site", "Corrected; stale 30-day comments fixed across config and page headers"],
      ["M7", "P2 (fixed)", "Honesty", "Trial clock starts at signup; email-confirmation delay burns days silently", "One-line disclosure on /trial and pricing FAQ"],
      ["S12", "P3 (fixed)", "Auth surface", "ResetPassword allowed 6-char passwords vs 8 at signup", "Aligned to 8"],
      ["M10", "P3 (fixed)", "Accessibility", "Login inputs lacked label htmlFor/id; error text contrast ~3:1", "Fixed"],
      ["S1", "P3 (no change)", "Push endpoint", "send-push-notification runs verify_jwt=false, BUT index.ts:62-87 validates the job row (exists, unprocessed, teacher match) and takes all content from the DB row", "Verified already mitigated; downgraded from P1; documented"],
      ["S8", "P3 (no change)", "Backup export", "student_qr_tokens exported with token column; header comment claimed no tokens exported", "Comment corrected to document the restore-fidelity trade-off; export unchanged"],
      ["S6", "P3 (deferred)", "Login security", "login_attempts lockout machinery (migration_011) is dead code; no is_locked_out reference in src/", "Backlog; no user impact (GoTrue defaults + client cooldown active)"],
      ["S9", "P3 (fixed)", "Portal payload", "Portal RPC returned unbounded history arrays", "Migration 054: arrays bounded 50-400 rows"],
      ["S11", "P3 (deferred)", "RLS gap", "homework_tasks/homework_task_status lack teacher SELECT; tables are dead (homework lives in attendance_records)", "Backlog: add SELECT or drop tables"],
      ["PF1", "P2 (deferred)", "Performance", "loadAll fetches all exam_scores and standalone_exam_scores unbounded", "Backlog with design care (ordering pitfall); indexes from PF2 already cut scan cost"],
    ],
    { zebra: true }
  ),
  body("", { after: 60 }),
  body("Verified-good areas worth recording because they were explicitly probed: row-level security is present on all user tables with workspace scoping; migration 042 hardening behaves as documented; the portal write surface is limited to token-resolved homework-done and notification-read plus push registration; admin support sessions are DB-authorized, time-capped, and audited; no service-role key, secret, or hard-coded token exists anywhere in frontend code; the CSP, HSTS, X-Frame-Options DENY, nosniff, and Referrer-Policy headers are live and correct; the service worker is push-only with no fetch handler, so stale-HTML caching is impossible by construction."),
];

const domains = [
  h1("4. Public Website, UX, Security, Reliability, and Performance"),
  h2("4.1 Public website and conversion"),
  body("The post-redesign landing page reads cleanly: problem story, four-step workflow, real screenshots, owner-view section, pricing, FAQ, and closing CTA. CTA density is appropriate (five trial entry points and four WhatsApp touchpoints), the FAQ answers real objections including cancellation and data preservation, and there are no fabricated testimonials. The trial path genuinely works without a card: signup requires only name, email, phone, and password, email confirmation gates access, and onboarding sets up the center. The gaps were honesty gaps rather than design gaps, and all three (Excel import, expenses, branches) plus the estimate-only statistics band are now either removed or explicitly qualified on the live site. The one remaining conversion-mechanics gap is analytical, not visual: before this audit the marketing funnel events never reached PostHog, so trial-click-to-signup conversion was unmeasurable; the bridge shipped in this audit closes that."),
  h2("4.2 SEO technical"),
  body("SEO infrastructure is unusually mature for this stack: 13 routes prerendered at build time with per-route titles, descriptions, canonicals, Open Graph and Twitter cards, page-specific JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, Article, Breadcrumb), an accurate sitemap with no 404 entries, robots rules covering both classic and AI crawlers, an llms.txt with verified facts, and a Google verification file. hreflang is correctly unnecessary for a single-locale Arabic site. The audit fixed the llms.txt retention and language claims, added /deploy/ to the eight AI-bot groups (they do not inherit from the main group), and bumped lastmod on the three pages whose copy actually changed. Remaining nits (article og:image aspect, soft-404 redirect for unknown marketing paths) are recorded in the backlog."),
  h2("4.3 Product workflows"),
  body("Session lifecycle invariants hold: lesson open-or-reuse is load-gated and DB-constrained; SAVE does not FINISH; completed lessons are read-only behind an explicit per-session edit toggle; finish converts unrecorded students to absent via an RPC and is idempotent. Attendance writes are guarded per-student with optimistic rollback and undo. The WhatsApp queue preserves state across reloads, deduplicates at the UI level, and logs sends; duplicate prevention is advisory by design, which the product copy does not overstate. Offline handling is honest everywhere except the one path fixed in this audit: standalone exam scores now genuinely queue. The auto-archive engine (Task 42) re-verified correct, including the evidence-consuming re-archive guard; its residual caveats (client-driven timing, 5000-row attendance window) fail safe - they can delay archiving but cannot cause a false archive."),
  h2("4.4 Reliability and data integrity"),
  body("Backups are weekly, scheduled, private-bucket, admin-gated, audited, and restorable via a security-definer RPC; the export includes portal tokens by design so printed QR links survive a disaster restore, which is now documented in the function header instead of contradicted by it. Subscription expiry pauses access without deleting data, is audited, and has an admin reactivation path with email retry. The realtime layer uses one channel per teacher with proper cleanup; the offline queue persists in IndexedDB with a localStorage fallback and auto-syncs after reconnect. Undo history does not survive reload (metadata only) and every undo triggers a full refetch - acceptable at current scale, recorded as a backlog refinement."),
  h2("4.5 Performance"),
  body("Measured on the production build: the entry bundle is 681 KB raw / 204 KB gzip, with effective route-level code splitting (12 lazy areas, chart.js behind lazy Charts, jspdf/qrcode/html2canvas dynamic, html5-qrcode lazy, PostHog on idle). Prerendered marketing pages now paint instantly for humans, not just crawlers. The remaining performance work is database-shaped rather than frontend-shaped: the three indexes added in migration 054 remove the worst per-boot scans, while bounding the exam_scores fetch (PF1) is deliberately deferred because a naive limit orders the wrong end and the data feeds score-editing UIs. Dead static assets (6.4 MB mascot set, 604 KB unused fonts) were removed from the deploy path; the 15.6 MB ad bundle under public/deploy/ stays because the admin backup panel serves its setup file from it."),
];

const backlog = [
  h1("5. Prioritized Backlog with Acceptance Criteria"),
  body("Items are ordered by expected impact per unit of risk. Each has an acceptance criterion that can be checked mechanically. Nothing here blocks production; the P0 tier is empty by design because both candidate P0s were resolved by evidence (S1 downgraded, S3 fixed)."),
  tableTitle("Table 5-1. Backlog"),
  dataTable(
    [8, 12, 44, 36],
    ["Tier", "ID", "Item", "Acceptance criterion"],
    [
      ["P1", "S3a", "Rotate all five exposed credentials (Supabase access token, Vercel, GitHub, DB URL, v0-sms) - they lived in local git history", "Old tokens return 401 from their APIs; new tokens stored outside the repo"],
      ["P2", "S5a", "Ship a real assistant-consent flow (the assistant_requests table exists but nothing approves requests)", "New assistant can only join after approving a request; owner settings UI reflects pending state"],
      ["P2", "PF1", "Bound the loadAll exam_scores/standalone_exam_scores fetches (newest-first window + targeted refetch, prune section_scores from the boot payload)", "Boot payload for the 972-student test account drops measurably; score editing still correct after targeted refresh"],
      ["P2", "W3", "Raise the allAttendance 5000-row window or make the auto-archive evidence window date-bounded per group", "Dry-run script on the 958-candidate group returns identical candidate set before and after"],
      ["P2", "M-branch", "Either implement branches (admin-labeled grouping) or delete branch copy everywhere permanently", "rg for branch claims returns only roadmap mentions"],
      ["P2", "M8b", "Self-host Cairo font to remove the render-blocking Google Fonts round-trip", "No third-party font request on landing; font-display swap unchanged"],
      ["P3", "S6", "Wire is_locked_out into sign-in or drop login_attempts machinery", "Either lockout demonstrably blocks a 6th attempt, or the table and RPCs are gone"],
      ["P3", "S11", "Add teacher SELECT policies to homework_tasks/homework_task_status or drop the dead tables", "information_schema shows policies, or tables absent"],
      ["P3", "S10", "Make the unused public student-qr storage bucket private or delete it", "Bucket not publicly listable (or absent); no src reference breaks"],
      ["P3", "S14", "Delete the stray supabase/vercel.json (rewrites-only, would ship headerless if ever deployed as project root)", "File absent from origin/main"],
      ["P3", "M9", "Generate sitemap lastmod at build; fix article og:image aspect; serve 404 instead of soft-redirect for unknown marketing paths", "Build artifact contains per-route dates; /nonexistent returns 404 status"],
      ["P3", "W5", "Make undo local where possible instead of full loadAll refetch", "Undo latency no longer correlates with total row count"],
      ["P3", "W6", "Prune stale per-lesson localStorage keys at boot", "Keys older than 30 days removed on load"],
      ["P3", "CI", "Add a minimal GitHub Action: oxlint + build + marker greps on PR", "PR shows required check; main protected"],
      ["P3", "Dead code", "Delete legacy AnalyticsArea/InsightsArea/PreviewDashboard and unimported lib leftovers", "Build green; bundle size unchanged or smaller"],
    ],
    { zebra: true }
  ),
];

const implemented = [
  h1("6. Implemented Changes and Rationale"),
  h2("6.1 Database - migration 054 (applied to production, verified)"),
  body("The migration was generated programmatically from the live production function definitions rather than hand-transcribed, with 14 anchored patches that abort loudly if the source drifts; this eliminates the transcription-error class entirely. All patches are non-destructive: create-or-replace preserves every identity signature, indexes use IF NOT EXISTS, no data is read or modified, and the whole file ran in one transaction via the Management API (HTTP 201) with 11/11 post-checks green. The revocation fix for portal links was designed around a measured fact - 1069 of 1822 students have no token row, so requiring a live token row in the legacy UUID fallback would have broken 58 percent of portal links; instead the fallback is blocked only when a revoked token exists, which changes nothing today (zero revoked tokens) and makes future revocations actually revoke. The assistant-binding guard encodes the real harm observed in production data: one bound member owns 29 students, meaning their my_workspace_owner flipped away from their own center; accounts with their own students or groups can no longer be bound as assistants, while the legitimate empty-account co-teacher flow is preserved."),
  h2("6.2 Frontend - deploy 1b56834e"),
  body("Sixteen files changed. The offline standalone-score fix reuses the exact queue shape the attendance path has used in production for months, so the sync semantics are proven rather than novel. The local-date fix aligns the general-purpose todayISO() with the rule the auto-archive engine already documented and uses; the smoke test opened a session, marked attendance, and found no date anomalies. The prerender fast-path hides the splash only when the prerendered content actually matches the URL (any non-root path, or root without a query string), respects the diagnostics escape hatch, and hides rather than removes the node because the head boot-layer repaints a missing splash on DOMContentLoaded - a subtle interaction caught by reading the boot layer before shipping. The marketing honesty edits were confined to copy and one footnote paragraph; no layout structure changed, so the prerendered pages kept their shape (verified by byte-level marker checks on the live HTML)."),
  tableTitle("Table 6-1. Changed files"),
  dataTable(
    [50, 50],
    ["File (deploy repo layout)", "Change"],
    [
      ["frontend/src/store/WorkspaceStore.jsx", "W1 offline score queue; W2 local todayISO"],
      ["frontend/index.html", "M8 prerender fast-path (ES5, guard-preserving)"],
      ["frontend/src/pages/LandingPage.jsx", "M1 Excel promise removed; M4 estimates footnote"],
      ["frontend/src/pages/Signup.jsx", "M2 expenses claim replaced with real archive feature"],
      ["frontend/src/pages/Login.jsx", "M10 labels + contrast"],
      ["frontend/src/pages/ResetPassword.jsx", "S12 minimum length 8"],
      ["frontend/src/marketing/pages/PricingPage.jsx", "M2/M3/M7 copy + roadmap footnote"],
      ["frontend/src/marketing/pages/CorePages.jsx", "M7 trial-clock line on /trial"],
      ["frontend/src/marketing/pricing.js", "M3 branch axis qualified; capability lines made real"],
      ["frontend/src/marketing/config.js", "M5 PostHog bridge; M6 comment"],
      ["frontend/src/lib/posthog.js", "M5 expose client + drain backlog"],
      ["frontend/public/llms.txt, robots.txt, sitemap.xml", "M6/M9 static corrections"],
      ["frontend/public/zaki/ (15 files), frontend/public/fonts/ (2 files)", "PF4 dead-weight removal (zero references verified)"],
      ["supabase/migration_054_security_rpc_hardening.sql", "New migration (applied + verified in production)"],
      ["supabase/functions/admin-backup/index.ts", "S8 header comment corrected (no functional change)"],
    ],
    { zebra: true }
  ),
];

const tests = [
  h1("7. Tests Executed and Real Results"),
  body("Every command below was executed in this session; results are reported as observed, including the two failures that were caught and fixed during the work (a CRLF mismatch and a missing-statement-terminator in the migration builder, both caught by the apply step and corrected before any production effect)."),
  tableTitle("Table 7-1. Verification matrix"),
  dataTable(
    [34, 33, 33],
    ["Check", "Command / method", "Result"],
    [
      ["Lint", "bunx oxlint src", "0 errors (78 pre-existing warnings, unchanged)"],
      ["Build (sandbox)", "bun run build", "Green; 13 routes prerendered; entry 681KB/204KB gzip"],
      ["Build (worktree)", "bun install --frozen-lockfile + bun run build in frontend/", "Green; markers verified in worktree dist"],
      ["Marker checks", "rg over dist HTML + JS chunks", "All 12 expected markers present; Excel promise 0 matches; zaki absent"],
      ["Migration apply", "Management API query (single transaction)", "HTTP 201; 11/11 post-checks green (guards, grants, indexes, portal anon access intact, junk-token returns null)"],
      ["Migration generation", "scripts/audit54_build_migration.py from live defs", "14/14 anchored patches applied; 2 build failures caught and fixed pre-apply"],
      ["Browser smoke - landing", "agent-browser on :4173", "Prerendered content instant; splash removed after boot; boot flag set"],
      ["Browser smoke - auth route", "/?auth=login", "Login form renders; fast-path correctly skipped"],
      ["Browser smoke - pricing", "/pricing", "6 plan cards; roadmap qualifier and real capability present"],
      ["Browser smoke - app core", "demo login, session open, attendance mark", "Archive engine intact; no NaN dates; zero feature console errors"],
      ["Live verification", "curl against al-nokhbba.vercel.app", "Fast-path, honesty copy, robots 9x, llms.txt, sitemap, zaki 404, deploy asset 200, bundle markers, Signup chunk, CSP/HSTS/XFO intact"],
      ["Vercel deploy", "scripts/audit_watch_deploy.py", "READY for sha 1b56834e"],
    ],
    { zebra: true }
  ),
  body("", { after: 60 }),
  body("Not tested, by scope: the Resend email path (RESEND_API_KEY is not configured; the code path is a graceful no-op), real device push delivery (requires an opted-in parent device; the endpoint contract was verified by code reading), and load testing under production concurrency. No destructive test was run against production; the demo environment covered interactive flows."),
];

const unresolved = [
  h1("8. Unresolved Issues and Decisions Requiring Approval"),
  body("Five items need owner decisions rather than engineering effort. First, credential rotation: the five files in .secrets/ were tracked in three local commits and are now untracked, but rotation is the only real remediation and only you can perform it (Supabase account tokens page, Vercel and GitHub token settings, and the DB password). Second, the assistants promise: the product currently gives assistants full workspace access; either ship scoped permissions or keep the corrected copy, but decide which before the next pricing page revision. Third, branches: the roadmap qualifier is honest today, but a decision to build or permanently drop the concept should land within a quarter so the qualifier does not itself become stale. Fourth, backup token inclusion: the export contains portal tokens by design for restore fidelity; if you prefer confidentiality over restore fidelity, say so and the column will be stripped with a documented QR-regeneration step after restore. Fifth, the deferred P2s (PF1 payload bounding, assistant consent flow, attendance window) are safe to schedule anytime but are not urgent; the costed hosting assessment in chapter 9 is the larger strategic decision."),
];

const hosting = [
  h1("9. Hosting Migration Assessment (estimates, no action taken)"),
  body("Current monthly cost is effectively the sum of Vercel Pro and Supabase Pro - roughly USD 45 per month combined (estimate; verify against current invoices). The long-term preference is independence from both vendors where a safer, economical alternative exists. The assessment below is component-by-component; nothing was migrated, and the recommendation is deliberately conservative because the current setup is small, reliable, and fully in budget."),
  tableTitle("Table 9-1. Component-by-component portability (all costs are estimates)"),
  dataTable(
    [18, 30, 26, 26],
    ["Component", "Portability", "Alternative and est. cost", "Verdict"],
    [
      ["Frontend hosting", "Trivial: static build with prerendered output; vercel.json headers/rewrites map to any CDN", "Cloudflare Pages $0-5/mo or Netlify $0-19/mo", "Low risk; can move any time; keep Vercel until an invoice reason exists"],
      ["Postgres database", "High: vanilla Postgres with standard extensions (pg_cron, pg_net are the two vendor-coupled pieces)", "Managed Postgres $15-25/mo (Neon/Supabase-agnostic/Hetzner + backup)", "Medium risk: pg_cron jobs and pg_net triggers need replacement (systemd timer + a worker)"],
      ["Auth (GoTrue)", "Medium: Supabase client SDK is used throughout; sessions, email confirmation, password reset depend on GoTrue", "Self-hosted GoTrue or Authentik/Authelia behind the app; or keep Supabase", "Highest-risk item; not worth migrating while DB stays on Supabase"],
      ["Storage (2 buckets)", "High: S3-compatible API", "Any S3 $1-3/mo at current size", "Low risk"],
      ["Edge functions (3)", "Medium: Deno-based; one is called by a DB trigger", "A small worker service (Hetzner VPS or Fly.io, $5-10/mo)", "Coupled to DB triggers; migrate together with the DB"],
      ["Scheduled jobs", "Medium: pg_cron (weekly backup, hourly expiry flip)", "cron on any VPS calling the same endpoints", "Moves with the DB"],
      ["Backups", "High: XLSX in a private bucket; scriptable", "Same script against any storage + offsite copy", "Low risk; add an offsite copy regardless"],
      ["Domain/SSL", "Full control already", "DNS at registrar; certificates automatic on any CDN", "No action"],
    ],
    { zebra: true }
  ),
  body("", { after: 60 }),
  body("Least-risk path if independence is pursued: (1) move frontend hosting to Cloudflare Pages (an afternoon; headers translate one-to-one; rollback is instant); (2) keep Supabase as the application backend and stand up a nightly logical backup to external storage (already scriptable via the Management API), which removes data-portability fear; (3) only then evaluate moving Postgres to a managed provider, replacing pg_cron with a timer and rewriting the three edge functions as a small worker - a 1-2 week project best done with a staging parallel run. Estimated end state after steps 1-2: roughly USD 25-30 per month with vendor lock-in reduced to the data layer. Rollback for step 1 is repointing DNS; for step 3 it is restoring the Supabase connection string, so both are reversible. The overriding constraint is that auth and the DB-triggered push path are the only genuinely coupled components; as long as those stay on Supabase, everything else can move or stay without pressure."),
];

const gitArtifacts = [
  h1("10. Git Artifacts"),
  body("Feature branch: audit/deep-product-audit-2026-10 (pushed to origin for review). Deploy commit: 1b56834e on origin/main, fast-forwarded from 4dec6e71 - no force-push, no history rewrite. Changed files: 16 (14 modified, 2 added), +703/−63, listed in Table 6-1. No pull request was opened because this project deploys from main by established workflow; the branch exists on GitHub if a PR is desired (compare URL: github.com/J0e0000/Alnokhba/compare/4dec6e71...1b56834e). Migration 054 is committed in the same tree (supabase/migration_054_security_rpc_hardening.sql) and was applied to production out-of-band via the Management API with verification, consistent with the project convention that migration files are reviewed artifacts and their application is explicit. The local sandbox mirror commit (2174cd64) additionally untracks .secrets/ and records the mirror sync; local commits are not pushed by design."),
  body("Production state at delivery: https://al-nokhbba.vercel.app serving commit 1b56834e; migration 054 live with guards verified by catalog queries; three new indexes present; portal RPCs still anonymously callable with junk tokens returning null rather than errors; marketing honesty copy live on /, /pricing, and /trial; the conversion funnel now visible in PostHog from the next visitor onward."),
];

// ── assembly ──────────────────────────────────────────────────────────────
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };
const headerBar = () => new Header({
  children: [new Paragraph({
    alignment: AlignmentType.RIGHT, spacing: { after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.innerLine, space: 4 } },
    children: [new TextRun({ text: "Alnokhba Edu - Deep Product Audit - October 2026", size: 16, color: P.secondary, font: EN })],
  })],
});
const pageFooter = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary, font: EN })],
  })],
});

const doc = new Document({
  creator: "Alnokhba Edu Engineering",
  title: "Alnokhba Edu - Deep Product Audit",
  styles: { default: { document: {
    run: { font: EN, size: 22, color: P.body },
    paragraph: { spacing: { line: 312 } },
  }}},
  features: { updateFields: true },
  sections: [
    { // Section 1: cover — margin 0, no footer/header
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "Alnokhba Edu Deep Product Audit",
        subtitle: "Evidence-based audit of the full repository, prioritized fixes, and shipped improvements",
        englishLabel: "PRODUCT ENGINEERING AUDIT",
        metaLines: [
          "Production: https://al-nokhbba.vercel.app",
          "Repository: github.com/J0e0000/Alnokhba (branch audit/deep-product-audit-2026-10)",
          "Deploy commit: 1b56834e on origin/main - migration 054 applied and verified",
          "Audit date: 23 October 2026",
        ],
        footerLeft: "Prepared by the product engineering audit",
        footerRight: "Confidential - internal",
        palette: { bg: P.bg, accent: P.accent, cover: P.cover },
      }),
    },
    { // Section 2: front matter (TOC) — Roman
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: headerBar() },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, color: P.primary, font: EN })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"", italics: true, size: 18, color: "888888", font: EN })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    { // Section 3: body — Arabic numerals from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: headerBar() },
      footers: { default: pageFooter() },
      children: [...exec, ...arch, ...findings, ...domains, ...backlog, ...implemented, ...tests, ...unresolved, ...hosting, ...gitArtifacts],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/Alnokhba-Deep-Product-Audit-2026-10.docx", buf);
  console.log("WROTE download/Alnokhba-Deep-Product-Audit-2026-10.docx", buf.length, "bytes");
});


