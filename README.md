# Alnokhba Edu · النخبة

**Arabic-first (RTL) management platform for teaching centers** — students, groups, sessions, QR attendance, homework, exams, WhatsApp report delivery, parent notifications, insights, and automated backups.

Live: **https://al-nokhbba.vercel.app**

## Overview

Alnokhba is a SaaS built for Egyptian teaching centers: teachers run their day-to-day inside one workspace while the admin keeps full control of accounts, subscriptions, and data safety. The UI is Arabic-first (RTL, Egyptian-Arabic microcopy) because that is what the staff, parents, and students actually use.

- **Role-based workspaces** — admin, teacher, assistant; the admin dashboard adds users, teams, analytics, backups, and account actions
- **Session workflow** per group — attendance (including QR scanning), interaction & homework tracking, exams, and session reports, with an explicit edit mode for past sessions
- **Report studio** — templated, student-aware reports sent directly from the app via a WhatsApp message queue; custom messages to selected recipients
- **Parents** — web-push subscriptions and a WhatsApp send log
- **Subscriptions** — 14-day trial, expiry gating, and a renewal-awareness banner when 3 days or fewer remain
- **Admin backups** — weekly scheduled (Friday 22:00, Cairo) plus on-demand XLSX snapshots in a private storage bucket, signed download URLs, retries, and a selective restore wizard with conflict preview
- **Marketing site** — 13 routes prerendered at build time with per-route title, canonical, og:image, and JSON-LD

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 19 · Vite 8 · Tailwind CSS v4 · Arabic RTL |
| Backend | Supabase — Auth, Postgres (RLS), Storage, Edge Functions (Deno) |
| Hosting | Vercel — static SPA + prerendered marketing pages, `trailingSlash: false`, CSP in `vercel.json` |
| Analytics | PostHog (allowed in CSP) |
| Libraries | chart.js · animejs · jspdf · docx · html2canvas-pro · html5-qrcode · qrcode |
| Tooling | Bun lockfile · oxlint |

## Repository layout

```
frontend/            The SPA — what Vercel actually deploys
  src/               App code (areas, pages, components, lib, marketing)
  public/            Static assets served as-is (robots.txt, sitemap.xml, llms.txt, …)
  scripts/           Build pipeline: css-compat.mjs, prerender.mjs
  DESIGN.md          Design system notes
  vercel.json        Security headers / CSP, trailingSlash
supabase/            Backend
  migration_*.sql    Numbered SQL migrations (applied manually — see below)
  functions/         Edge Functions (Deno): admin-backup, send-push-notification,
                     admin-account-actions
scripts/             Ops & diagnostics (smoke-test, perf-measure, err-stack,
                     insights/analytics tests)
```

## Local development

```bash
git clone https://github.com/J0e0000/Alnokhba.git
cd Alnokhba/frontend
bun install --frozen-lockfile      # npm install works too (package-lock.json present)
bun run dev                        # http://localhost:5173
```

Create `frontend/.env.local`:

```ini
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>

# optional
VITE_PUBLIC_SITE_URL=https://al-nokhbba.vercel.app
VITE_VAPID_PUBLIC_KEY=<web-push public key>
VITE_POSTHOG_KEY=<posthog key>
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

Only the **anon** key belongs in the frontend — Row Level Security is the security boundary. Never commit `.env*` files, and never place service-role keys in client code.

## Scripts (`frontend/`)

| Command | What it does |
|---|---|
| `bun run dev` | Vite dev server |
| `bun run build` | `vite build` + `css-compat.mjs` + `prerender.mjs` — prerenders the 13 marketing routes to static HTML with full SEO head; **hard-fails** on any validation error |
| `bun run preview` | Preview the production build |
| `bun run lint` | oxlint |
| `bun run start` | Dev server exposed on `0.0.0.0:3000` |

## Database & migrations

- Schema changes live in numbered files `supabase/migration_*.sql` (the latest is `migration_047_report_template_columns.sql`).
- Apply them **manually, in order**, through the Supabase SQL Editor — the deploy pipeline does not run migrations.
- Sensitive flows use `security definer` RPCs that re-check authorization server-side; the client never trusts the UI alone.

## Edge Functions (`supabase/functions/`)

| Function | Purpose | Deploy |
|---|---|---|
| `admin-backup` | Manual + weekly scheduled XLSX backups, signed download URLs (60 min), retry, selective restore | `supabase functions deploy admin-backup --no-verify-jwt` |
| `send-push-notification` | Web-push to parent subscriptions | `supabase functions deploy send-push-notification` |
| `admin-account-actions` | Admin account operations | `supabase functions deploy admin-account-actions` |

`admin-backup` runs with JWT verification off **by design**: every admin action verifies the caller's own JWT and `profiles.is_admin` server-side, and the scheduled path only accepts rows the DB scheduler itself created. Its full source is also published at [`/deploy/admin-backup-index.txt`](https://al-nokhbba.vercel.app/deploy/admin-backup-index.txt) so it can be pasted into the Supabase dashboard editor (kept out of indexing via `robots.txt`).

## Data export & backups policy

- Data export is an **admin-panel-only** action (one filter-aware CSV of the users overview); teacher panes intentionally have no export buttons.
- Backups export no passwords, hashes, tokens, or keys — ever.
- Restores are selective (per-teacher blocks) with a `skip` / `overwrite` strategy and a conflict preview before anything is written.

## Deployment

1. Push to `main` → Vercel builds automatically: `bun install --frozen-lockfile` → `bun run build`.
2. The output is the static SPA plus prerendered marketing routes; security headers and CSP come from `frontend/vercel.json`.
3. Search/GEO setup: `sitemap.xml`, `robots.txt` (with explicit AI-crawler rules), `llms.txt`, and a verified Google Search Console property.

## Conventions

- Arabic-first UI: RTL layout, Egyptian-Arabic microcopy; user-facing copy lives next to the components.
- Run `bun run lint` before pushing.
- Reports aim to aggregate meaningful events (not raw action logs); marketing copy only claims features that actually exist.
