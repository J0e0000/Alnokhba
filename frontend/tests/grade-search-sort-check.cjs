#!/usr/bin/env node
// ============================================================================
// Test 11/11 — Round 14: Exam grade-entry search bar + alphabetical sorting
// ============================================================================
// THE REQUEST this test guards (user's words):
//   "لما بعمل رصد امتحان وبكتب الدرجات عايز يبقى في سيرش بار بدل ما أعمل
//    scroll طالع نازل" + "القوائم مترتبة بالترتيب الأبجدي سواء بالعربي أو
//    بالإنجليزي" + "مفيش أي حاجة تانية تتغير".
//
// Proves at four levels:
//   1. SOURCE (ExamModal)  — grading table has the sticky search bar, filters
//      by normalized name, Enter-navigation follows VISIBLE rows, and what gets
//      SAVED is still the full present-students list (search can never change
//      or drop a saved grade).
//   2. SOURCE (Dashboard)  — the three student lists the teacher scrolls
//      (رصد الامتحان / رصد الحضور / قائمة الطلاب) are all sorted by name.
//   3. RUNTIME             — the shared helpers actually sort Arabic and
//      English names alphabetically (locale-aware, hamza/ة/ى tolerant search
//      normalization, numeric names, null-safe, non-mutating).
//   4. BUNDLE              — the built JS carries the search placeholder and
//      the collation call (run after `npm run build`).
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.error('  ✗ ' + m); failures += 1; };

console.log('Round 14 — exam grade-entry search + alphabetical lists\n');

// ── Part 1: ExamModal source wiring ────────────────────────────────────────
console.log('[1/4] ExamModal (رصد الامتحان) source wiring');
const modal = fs.readFileSync(path.join(ROOT, 'src/components/ExamModal.jsx'), 'utf8');

if (/import\s*\{[^}]*sortStudentsByName[^}]*normalizeArabicForSearch[^}]*\}\s*from\s*['"]\.\.\/lib\/helpers['"]/.test(modal)
  || /import\s*\{[^}]*normalizeArabicForSearch[^}]*sortStudentsByName[^}]*\}\s*from\s*['"]\.\.\/lib\/helpers['"]/.test(modal)) {
  ok('imports sortStudentsByName + normalizeArabicForSearch from ../lib/helpers');
} else {
  bad('ExamModal must import the shared sort/search helpers from ../lib/helpers');
}

if (/const \[gradeSearch, setGradeSearch\] = useState\(''\)/.test(modal)) {
  ok('gradeSearch state exists');
} else {
  bad('gradeSearch state missing — the search bar would be a dead input');
}
if (/\{ if \(open\) \{[\s\S]{0,400}setGradeSearch\(''\)[\s\S]{0,80}\}, \[open\]\)/.test(modal)) {
  ok('gradeSearch resets when the modal reopens');
} else {
  bad('gradeSearch must reset on modal open (stale filter across exams)');
}
if (/const visibleStudents = useMemo\(\(\) => \{[\s\S]{0,400}normalizeArabicForSearch\(gradeSearch\)[\s\S]{0,300}normalizeArabicForSearch\(s\.name\)\.includes\(q\)/.test(modal)) {
  ok('visibleStudents memo filters by Arabic-normalized name');
} else {
  bad('visibleStudents filter missing/broken — typing would not narrow the table');
}
if (/data-tour=['"]grade-search['"]/.test(modal) && /ابحث عن الطالب بالاسم/.test(modal)) {
  ok('sticky search bar rendered above the grading table (🔍 + placeholder + data-tour)');
} else {
  bad('the grade-entry search bar UI is missing');
}
if (/\{visibleStudents\.length\}\/\{presentStudents\.length\}/.test(modal)) {
  ok('result counter (visible/total) rendered');
} else {
  bad('result counter missing');
}
if (/onClick=\{\(\) => setGradeSearch\(''\)\}/.test(modal) && /مفيش طالب بالاسم ده/.test(modal)) {
  ok('clear button + empty-state with reset action');
} else {
  bad('clear button / empty state missing');
}
if (/visibleStudents\.map\(\(s, rowIdx\)/.test(modal)) {
  ok('grading table renders the FILTERED rows (tbody = visibleStudents)');
} else {
  bad('tbody must map visibleStudents — otherwise the search box does nothing');
}
if (/row \+ 1 < visibleStudents\.length/.test(modal)) {
  ok('Enter-key navigation follows the visible rows');
} else {
  bad('Enter navigation must use visibleStudents.length (stale refs would jump to hidden rows)');
}
// The save contract: filtering may NEVER change what is saved.
if (/const records = presentStudents\.map/.test(modal) && /allScoresFilled = presentStudents\.length > 0/.test(modal)) {
  ok('save() + allScoresFilled still operate on the FULL present list (search never drops a grade)');
} else {
  bad('save/allScoresFilled must stay on presentStudents — search filtering leaked into the save path');
}
if (/presentStudents = useMemo\(\(\) => sortStudentsByName\(/.test(modal) && /absentStudents = useMemo\(\(\) => sortStudentsByName\(/.test(modal)) {
  ok('present + absent lists sorted alphabetically');
} else {
  bad('presentStudents/absentStudents must be wrapped in sortStudentsByName');
}

// ── Part 2: Dashboard source wiring ────────────────────────────────────────
console.log('\n[2/4] Dashboard — the other student lists');
const dash = fs.readFileSync(path.join(ROOT, 'src/pages/Dashboard.jsx'), 'utf8');

if (/import\s*\{[^}]*sortStudentsByName[^}]*\}\s*from\s*['"]\.\.\/lib\/helpers['"]/.test(dash)) {
  ok('Dashboard imports sortStudentsByName');
} else {
  bad('Dashboard must import sortStudentsByName from ../lib/helpers');
}
if (/return sortStudentsByName\(students\.filter\(\(s\) => \{/.test(dash)) {
  ok('قائمة الطلاب (students tab) sorted alphabetically');
} else {
  bad('filteredStudents must be sorted — the main students list is still in insertion order');
}
if (/return sortStudentsByName\(students\.filter\(\(s\) => s\.group_name === sessionGroup\)\.map/.test(dash)) {
  ok('قائمة رصد الحضور (sessions tab) sorted alphabetically');
} else {
  bad('sessionStudents must be sorted — same scrolling pain as the exam list');
}
// Nothing else should have been touched in the render pipeline: the rows
// still key by id and selection is still an id-Set (sort-order agnostic).
if (/filteredStudents\.map\(\(s, i\) =>/.test(dash) && /sessionStudents\.map\(\(s, i\) =>/.test(dash)) {
  ok('row rendering unchanged (key=id, selection by id — sorting is display-only)');
} else {
  bad('row rendering changed — sorting must not touch selection/edit plumbing');
}

// ── Part 3: runtime behavior of the shared helpers ─────────────────────────
console.log('\n[3/4] Runtime: alphabetical sorting + search normalization');
(async () => {
  const helpers = await import(path.join(ROOT, 'src/lib/helpers.js'));

  if (typeof helpers.sortStudentsByName !== 'function' || typeof helpers.normalizeArabicForSearch !== 'function' || typeof helpers.compareNamesAlphabetically !== 'function') {
    bad('helpers.js must export sortStudentsByName / normalizeArabicForSearch / compareNamesAlphabetically');
    process.exit(1);
  }
  const { sortStudentsByName, normalizeArabicForSearch, compareNamesAlphabetically } = helpers;

  // 3a. Arabic alphabetical order (unambiguous letters: ب < خ < م < ي)
  const arabic = sortStudentsByName([
    { id: '4', name: 'يوسف' }, { id: '3', name: 'محمد' },
    { id: '2', name: 'خالد' }, { id: '1', name: 'باسم' },
  ]);
  const arabicOrder = arabic.map((s) => s.name).join(',');
  if (arabicOrder === 'باسم,خالد,محمد,يوسف') ok(`Arabic names sort alphabetically (${arabicOrder})`);
  else bad(`Arabic sort wrong: got ${arabicOrder}`);

  // 3b. English alphabetical, case-insensitive
  const english = sortStudentsByName([
    { id: '3', name: 'Zara' }, { id: '1', name: 'ali' }, { id: '2', name: 'Omar' },
  ]);
  const englishOrder = english.map((s) => s.name).join(',');
  if (englishOrder === 'ali,Omar,Zara') ok(`English names sort alphabetically, case-insensitive (${englishOrder})`);
  else bad(`English sort wrong: got ${englishOrder}`);

  // 3c. Mixed lists under the 'ar' collation: the Arabic block comes FIRST
  // (CLDR ar tailoring reorders Arab before Latn — the natural expectation for
  // an Arabic UI), each block alphabetical internally.
  const mixed = sortStudentsByName([
    { id: '5', name: 'محمد' }, { id: '2', name: 'Omar' }, { id: '4', name: 'أحمد' }, { id: '1', name: 'Ali' }, { id: '3', name: 'Sara' },
  ]);
  const mixedOrder = mixed.map((s) => s.name).join(',');
  if (mixedOrder === 'أحمد,محمد,Ali,Omar,Sara' || mixedOrder === 'Ali,Omar,Sara,أحمد,محمد') {
    ok(`Mixed list: each script block alphabetical (${mixedOrder})`);
  } else {
    bad(`Mixed sort wrong: got ${mixedOrder}`);
  }

  // 3d. Hamza-alef variants don't explode the comparator (never throws, stable)
  let hamzaOk = true;
  try {
    const hamza = sortStudentsByName([{ id: '1', name: 'أحمد' }, { id: '2', name: 'إبراهيم' }, { id: '3', name: 'آدم' }, { id: '4', name: 'اكرم' }]);
    if (hamza.length !== 4) hamzaOk = false;
  } catch { hamzaOk = false; }
  if (hamzaOk) ok('أ/إ/آ/ا variants compared without throwing');
  else bad('comparator threw on hamza-alef variants');

  // 3e. Numeric names: "طالب 2" before "طالب 10"
  if (compareNamesAlphabetically('طالب 2', 'طالب 10') < 0) ok('numeric:true — "طالب 2" sorts before "طالب 10"');
  else bad('numeric collation off — "طالب 10" would sort before "طالب 2"');

  // 3f. null/undefined-safe + non-mutating
  const input = [{ id: '2', name: 'زيد' }, { id: '1', name: null }, { id: '0' }];
  let safe = true;
  let sorted3;
  try { sorted3 = sortStudentsByName(input); } catch { safe = false; }
  if (safe && sorted3.length === 3 && input[0].id === '2' && input[1].id === '1') {
    ok('null/undefined names handled + input array NOT mutated');
  } else {
    bad('comparator must be null-safe and must not mutate the source array');
  }

  // 3g. search normalization: hamza/ة/ى/ئ/ؤ + Arabic digits + tashkeel + case
  const norm = (v) => normalizeArabicForSearch(v);
  const normOk =
    norm('أحمد') === norm('احمد') &&
    norm('فاطمة') === norm('فاطمه') &&
    norm('على') === norm('علي') &&
    norm('ؤ') === 'و' && norm('ئ') === 'ي' &&
    norm('٢٠٢٦') === '2026' &&
    norm('مُحَمَّد') === 'محمد' &&
    norm('AHMED') === 'ahmed' &&
    norm('  احمد   علي ') === 'احمد علي';
  if (normOk) ok('normalizeArabicForSearch: hamza/ة/ى/ئ/ؤ + digits + tashkeel + case + spaces');
  else bad('search normalization regressed — typing أحمد would not find احمد');

  // 3h. the EXACT filtering expression used by ExamModal behaves
  const roster = [{ id: '1', name: 'أحمد محمد' }, { id: '2', name: 'Logain' }, { id: '3', name: 'فاطمة' }];
  const q = normalizeArabicForSearch('احمد');
  const hits = roster.filter((s) => normalizeArabicForSearch(s.name).includes(q));
  if (hits.length === 1 && hits[0].id === '1') ok('typing "احمد" finds "أحمد محمد" in the grading table');
  else bad('filter expression failed to find hamza variant of the name');
  const q2 = normalizeArabicForSearch('loga');
  const hits2 = roster.filter((s) => normalizeArabicForSearch(s.name).includes(q2));
  if (hits2.length === 1 && hits2[0].id === '2') ok('English partial search works too (loga → Logain)');
  else bad('English partial match failed');

  // ── Part 4: built bundle carries the feature ─────────────────────────────
  console.log('\n[4/4] Built bundle verification');
  const distDir = path.join(ROOT, 'dist/assets');
  if (fs.existsSync(distDir)) {
    const jsFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
    const bundle = jsFiles.map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
    const hasPlaceholder = bundle.includes('ابحث عن الطالب بالاسم');
    const hasCollation = /localeCompare\([\s\S]{0,60}?[`"']ar[`"']/.test(bundle) || (bundle.includes('localeCompare') && /[`"']ar[`"']/.test(bundle));
    const hasEmptyState = bundle.includes('مفيش طالب بالاسم ده');
    if (hasPlaceholder) ok('bundle contains the grade-search placeholder string');
    else bad('bundle lost the grade search bar — rebuild with the fixed ExamModal');
    if (hasCollation) ok("bundle contains the locale-aware collation call (localeCompare + 'ar')");
    else bad('bundle lost localeCompare — alphabetical sorting is gone');
    if (hasEmptyState) ok('bundle contains the no-match empty state');
    else bad('bundle lost the empty state');
  } else {
    console.log('  (dist/ not built yet — skipping bundle assertions; CI builds run after this)');
  }

  console.log('');
  if (failures > 0) {
    console.error(`FAIL — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('PASS — grade-entry search bar + alphabetical lists are wired and behave');
})();
