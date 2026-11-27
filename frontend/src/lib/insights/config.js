// ═══════════════════════════════════════════════════════════════════════════
// INSIGHT_CONFIG — the explainable thresholds of فريق التحليل, extracted to
// their own module so light consumers (lib/reportBuilders via the eager
// exam workspace) don't pull the whole analysis engine into the first bundle.
// ═══════════════════════════════════════════════════════════════════════════

export const INSIGHT_CONFIG = {
  // Analysis window: compare the last 4 weeks against the 4 weeks before.
  windowDays: 28,

  // A group needs enough completed sessions in the window before any
  // group-level statement is honest at all.
  minSessionsPerGroup: 4,

  // Population materiality: a pattern must affect at least this many
  // students, or at least this share of the group (whichever is larger).
  minPopulation: 3,
  populationShare: 0.25,

  // ── Absence ──
  absenceBaseline: 0.15,   // expected normal absence for a healthy group
  absenceFloor: 0.30,      // clearly problematic level
  absenceDelta: 0.10,      // a rise of >= 10 points vs the previous window matters
  absenceImpactHigh: 0.35, // at this level the impact is high even without a trend

  // ── Repeated absence (per student) ──
  repeatAbsenceShare: 0.5, // absent for >= half of the group's held sessions
  repeatAbsenceMin: 3,     // and at least 3 absences in the window

  // ── Homework ──
  hwFloor: 0.6,            // below 60% completion the group loses pacing
  hwDelta: 0.15,           // a drop of >= 15 points vs the previous window
  hwMinRecords: 10,        // need a meaningful number of hw marks to compare

  // ── Exams ──
  examMinExams: 3,         // a trend needs >= 3 exams, not one bad day
  examRecent: 2,           // compare the last 2 exams vs everything before
  examDeclineShare: 0.12,  // >= 12% relative drop that is consistent

  // ── Warnings ──
  warningsNear: 1,         // students within 1 warning of the configured limit

  // ── Engagement (behavior logs, observable records only) ──
  engagementMinNotes: 2,   // >= 2 negative behavior notes in the window per student
}
