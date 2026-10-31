# ALNOKHBA EDU — DESIGN.md
## The visual & product contract for the rebuilt frontend

This document is the source of truth for the new Alnokhba Edu frontend.
Code that contradicts this file is wrong; update the code first, then this file.

Visual thesis: **"A calm, high-quality classroom operating system."**
Not an AI SaaS dashboard. Every screen answers: *what do I need to do now, for which session, for which student?*

---

## 1. Brand foundation

| Asset | Rule |
|---|---|
| Logo | Existing Alnokhba logo is untouched. Never redraw or re-color it. |
| Palette | Existing brand navy + gold. No purple/indigo startup palettes, no decorative gradients. |
| Typography | **Cairo** (Google Fonts, weights 400–900) for everything, Arabic-first RTL. Never swap to Inter/Roboto. |
| Icons | **Material Symbols Outlined** only — one coherent family. Never emoji as UI icons. Icons support text labels; text labels are the primary meaning. |
| Feel | Educational, reliable, fast, human, clear, modern, professional. |

## 2. Color tokens (`src/index.css`)

Two complete themes (light default + dark). Both are WCAG-checked:
body text ≥ 4.5:1, large text ≥ 3:1, in **both** themes.

### Core tokens (theme-aware via CSS vars)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--app-bg` | `#f5f8fc` | `#0e1424` | App background |
| `--brand-navy` | `#14213f` | `#101a30` | Brand navy — sidebar, session header band |
| `--brand-navy-light` | `#25355c` | `#1a2745` | Navy hover / secondary navy surface |
| `--brand-gold` | `#a06b2a` | `#f3d7a8` | Gold **as text** (darkened on light for contrast) |
| `--brand-gold-deep` | `#b07c33` | `#d4a373` | Gold accents, active tab underline |
| `--brand-gold-surface` | `#fff8ea` | `rgba(212,163,115,.12)` | Gold-as-background chips |
| `--accent-strong` | `#0e7f74` | `#46c8b8` | Primary action color |
| `--surface-solid` | `#ffffff` | `#182036` | Card/page surfaces |
| `--surface-container` → `-highest` | 3-step container ramp | same | Nested surface hierarchy |
| `--fg` / `--fg-muted` / `--fg-subtle` | `#1a2338` / `#47536e` / `#5d6b87` | `#e9eef8` / `#aab6cd` / `#93a1bb` | Text hierarchy (13:1 / 7:1 / 5:1) |
| `--surface-border` | `rgba(148,163,184,.28)` | `rgba(163,181,216,.16)` | Structure borders |
| `--input-bg` / `--input-border` | `#ffffff` / `#c3cddd` | `#131a2e` / `#33405f` | Form controls |

### Semantic status palette

| Status | Token family | Usage |
|---|---|---|
| Success / حاضر / مكتمل | `--ok` `--ok-strong` `--ok-bg` `--ok-border` | Present, completed homework, saved |
| Warning / ناقص | `--warn` … | Partial homework, attention states |
| Info | `--info` … | Neutral info, in-progress |
| Danger / غائب / لم يتم | `--danger` … | Absent, destructive, errors |

### Pipeline accents (from the prototype)

`--color-nk-navy #10182d` · `--color-nk-gold #d4a373` · `--color-nk-green #159570` · `--color-nk-blue #3182ce` · `--color-nk-rose #d45a68`

### Session workspace header

The Session Workspace keeps the prototype's **navy header band** in both themes:
`--ws-head-bg` (navy gradient), `--ws-head-fg` (white text), `--ws-mini-*` (the 5-metric mini summary chips).

**Rule:** gold is the brand accent for identity/active states; semantic status always wins over decoration.

## 3. Typography scale

Single family (Cairo). Hierarchy through weight + size, few sizes:

| Level | Class pattern | Spec |
|---|---|---|
| Display / page title | `text-2xl font-extrabold` | e.g. "مسار الحصص", greeting |
| Section title | `text-lg font-bold` | Panel headings |
| Body | `text-sm/base font-medium` | Default reading text |
| Supporting | `text-xs/text-[13px]` `--fg-muted` | Hints, captions |
| Metadata / table meta | `text-xs` `--fg-subtle` | Codes, dates, timestamps |
| Controls | `text-sm font-bold` | Buttons, segmented controls |

Do not introduce new sizes per screen. Weight (500/600/700/800) carries hierarchy.

## 4. Spacing system

Coherent Tailwind scale only: **1 / 2 / 3 / 4 / 6 / 8** (`gap-2`, `p-4`, `mt-6`…).
No random `mt-3.5`, `mt-7`, `mt-11`.

- **4** = inside-group spacing (row padding, chip padding)
- **6** = between groups in a panel
- **8** = between major panels
- Page content max-width with `mx-auto` + responsive gutters (`px-3` mobile → `px-6` desktop)

Spacing creates grouping → separation → priority. When two things relate, tighten; when they don't, separate.

## 5. Radii, borders, shadows

Restraint by semantic importance:

| Element | Treatment |
|---|---|
| Outer shell / sidebar | **No rounded container** — flat edges to the viewport |
| Cards (`nk-panel`, `glass-card`) | `border-radius: 16–18px`, 1px `--surface-border`, `--shadow-sm` |
| Inputs | `rounded-lg` (8px) |
| Buttons | `rounded-lg`/`rounded-xl` — **not every control is a pill** |
| Status pills (`nk-pill`) | pill-shaped **only** because they encode status, not for decoration |
| Modals | `rounded-2xl`, `--shadow`, overlay `rgba` |

Shadows: two tokens only (`--shadow-sm`, `--shadow`). No glow shadows on static elements; the `.glow-*` classes exist only for live/pending attention states.
Borders establish structure — do not add borders to everything.

## 6. Surfaces

- `--surface-solid` — page panels, tables
- `--surface-container` (+high/highest) — nested rows, table headers, hover fills
- Navy band (`--ws-head-*`) — Session Workspace header only
- No glassmorphism (`backdrop-filter: none` on `glass-card` — legacy name kept, effect removed). No frosted floating shells.

## 7. Button hierarchy (`src/index.css`)

| Level | Class | Use |
|---|---|---|
| Primary | `btn-navy` / `clay-btn-gold` / `btn-gold` | One primary action per view (حفظ الحضور، إنهاء الحصة) |
| Secondary | `clay-btn` / bordered neutral | Common secondary actions |
| Tertiary | `btn-ghost` | Low-stakes, inline actions |
| Destructive | `btn-danger` | Explicit red treatment, confirm dialog required (إنهاء الحصة uses modal confirm) |

Rules: clear Arabic verb labels; no giant CTAs inside the app; no icon-only destructive actions; primary buttons used sparingly.

## 8. Forms

- Inputs: `glass-input` — solid `--input-bg`, 1px `--input-border`, gold focus ring (`3px` 22% gold halo)
- Labels always visible (no placeholder-only forms); Arabic labels right-aligned
- Validation: inline `--danger` text under the field + `aria-invalid`; never color-only
- Numeric entry (scores/points): `inputMode="numeric"`, clamped to allowed range
- Never disable submit without an inline reason

## 9. Tables & rows

Dense but readable work areas, not card soup:

- Desktop: real tables (`nk-row` rows, sticky headers where long)
- Mobile: table rows convert to stacked list-rows (label+value pairs) — never horizontal scroll
- Student rows: code + name + status controls inline; search/filter above the table
- Zebra/hover fills from `--surface-container`; row actions inline as ghost buttons

## 10. Status rules (`nk-pill-*`)

Status is always **text + color** (never color-only):

| Pill | Meaning |
|---|---|
| `nk-pill-done` / `--ok` | done / حاضر / مكتمل / COMPLETED |
| `nk-pill-live` / `--gold` | IN PROGRESS / active stage |
| `nk-pill-pending` | NOT STARTED / لم يرصد |
| `nk-pill-neutral` | neutral / no action taken |
| `nk-pill-danger` | غائب / لم يتم / errors |

Session states map 1:1 to backend: `open` → IN PROGRESS, no row → NOT STARTED, `completed` → COMPLETED. State is never inferred from localStorage.

## 11. Navigation rules

- **Desktop:** stable navy left sidebar (`AppShell`) — Home / Session / Students / History / Reports / Analytics / Settings. Text labels primary, icons support scanning. Compact top bar (theme toggle, notifications, teacher identity).
- **Mobile:** bottom navigation (`nk-bottom-nav`) for top-level destinations only; task actions stay in-context/sticky. No hamburger for primary nav.
- Always show the user where they are (active state = gold underline/fill).
- Cross-navigation never mutates data — mutation lives in the Session Workspace only.

## 12. Modal rules

- `Modal.jsx` base: `role="dialog"` + `aria-modal`, labelled title, Esc/backdrop close (except destructive confirms)
- Confirm dialogs **only** for consequential actions (FINISH SESSION, bulk deletes)
- Normal successes use toasts, never confirmations
- Mobile: modals become bottom sheets where content is list-like

## 13. Responsive rules

- No horizontal scrolling anywhere for the main workflow (verified at 390px)
- Breakpoints: mobile-first; sidebar collapses to bottom nav < `lg`
- Session summary metrics: 3-column compact grid on mobile, inline chips on desktop
- Tables → stacked rows on mobile; sticky action areas where useful
- Touch targets ≥ 40px

## 14. Loading states

- Boot splash (`index.html` boot layer) → landing/dashboard never blank
- `Skeleton.jsx` mirrors the eventual content structure (rows of the actual layout)
- Session restore: loading band in the workspace header, not a full-screen blocker
- Buttons show busy state while saving; no double-submit
- No white flashes: theme vars resolve before first paint

## 15. Empty states

Every data surface has one. Format: **what is empty → why → what to do next**.

- No sessions today → "لا توجد حصص مجدولة اليوم" + group schedule hint + link to Settings
- No students found → search refinement hint
- No reports for this period → complete a session first hint
- No pending actions → confirmation that everything is done

No decorative illustrations; one Material icon max, muted.

## 16. Error states

Errors name the failed action and preserve user work:

- "تعذر حفظ الحضور — لم تفقد تغييراتك، حاول مجددًا" pattern (action + data-safe + retry)
- Inline field errors for forms; banners for page-level; toasts for transient
- `ProductionErrorBoundary` catches render crashes with NK- trace id + diagnostics export (`?diag=1` — use `&diag=1` when the URL already has a query param)
- Offline: `OfflineBanner` + queued writes via `offlineQueue`

## 17. Toasts & feedback

Non-blocking (`ToastContext`) for: attendance saved, homework saved, grade updated, session progress saved.
No interruption of workflow for normal success. Undo available via `UndoSnackbar` where the store supports it (attendance/points).

## 18. Motion

Subtle, functional only:

- `animate-slide-up` for panels entering (150–250ms ease-out)
- `animate-scan` only in the QR scanner (signals active scanning)
- State-change feedback: pill/segment transitions ~160ms
- No bounce, no scale-on-every-button, no background animation, no page-transition theatrics
- `prefers-reduced-motion`: animations gated by media query — respect it

## 19. Accessibility

WCAG 2.2 principles:

- Contrast targets enforced by token values (see §2) in both themes
- Semantic elements: real `<button>`, `<input>`, `<table>` — no clickable divs
- Visible keyboard focus (gold ring, same token as input focus)
- Accessible dialogs/tabs per WAI-ARIA patterns; labels on all controls
- Status never conveyed by color alone (§10)
- RTL-native layout; logical properties so themes/RTL never break each other

## 20. Anti-slop checklist (enforced before any review sign-off)

None of the following may appear:

- purple/indigo gradients · glassmorphism · giant rounded-2xl-everywhere cards
- 3-card marketing grids inside the app · identical repeated KPI cards (Home has exactly 3 stats)
- unnecessary pill buttons · fake metrics · dashboard hero sections
- decorative blobs · excessive shadows · emoji icons · generic AI-SaaS copy
- repeated colored left borders · bounce/spring animation everywhere

Test: *"Could I swap the logo and nobody would notice?"* — if yes, the design is not Alnokhba-specific enough.

## 21. Product-specific error prevention

- **Student History = READ + CONTACT only.** No attendance/interaction/homework/grade actions exist there — ever.
- **Session Workspace = the only place session data is recorded** (Attendance → Interaction+Homework → Exams → Review → Report/Finish).
- **SAVE ≠ FINISH.** SAVE persists progress; FINISH is an explicit, confirmed completion. No automatic finishing.
- Exam max-score edit and student-score edit are separate operations with separate RPCs (`update_exam_max_score` / `update_student_exam_score`, version-checked).
- Attendance resets the current input to **neutral** after save (neutral ≠ absent).
- Fewer mutation points = fewer errors. Never add shortcuts that mutate session data from elsewhere.
