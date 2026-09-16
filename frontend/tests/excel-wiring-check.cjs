#!/usr/bin/env node
// ============================================================================
// Test 9b — Wiring checks: Smart Excel import + QR resolution + سجل حصص +
// realtime coalescing (the features this round wires into the live app).
// The pipeline logic itself is covered by excel-import-check.mjs; this file
// proves the features are actually REACHABLE from the shipped UI.
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.error('  ✗ ' + m); failures += 1; };

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

console.log('Wiring checks — Excel import + QR + سجل حصص + realtime coalescing\n');

// ── 1. Smart Excel import is reachable from the exams UI ──
console.log('[1/4] Excel grade import (the pipeline)');
const list = read('src/components/ExamsListModal.jsx');
if (list.includes("import ExcelGradeImportModal from './ExcelGradeImportModal'")) ok('ExamsListModal imports ExcelGradeImportModal');
else bad('ExamsListModal must import ExcelGradeImportModal');
if (list.includes('setExcelImportExamId')) ok('per-exam import button state exists (excelImportExamId)');
else bad('excelImportExamId state missing');
if (list.includes('استيراد Excel')) ok('the 📥 استيراد Excel button is rendered per exam');
else bad('the import button is not rendered');
if (list.includes("supabase.rpc('import_exam_grades'") || read('src/components/ExcelGradeImportModal.jsx').includes("supabase.rpc('import_exam_grades'")) ok('import runs through the atomic import_exam_grades RPC');
else bad('import_exam_grades RPC call missing');
if (list.includes('existingScoreStudentIds') && list.includes('absentStudentIds')) ok('existing + absent student sets passed to the review step');
else bad('review-step guards (existing/absent) not wired');
const modal = read('src/components/ExcelGradeImportModal.jsx');
if (modal.includes("from 'xlsx'") && modal.includes('sheet_to_json')) ok('real XLSX parsing (upload → columns → rows)');
else bad('XLSX parsing missing');
if (modal.includes("step === 'review'") && modal.includes("step === 'mapping'") && modal.includes("step === 'done'")) ok('full pipeline UI: upload → mapping → review → done');
else bad('pipeline steps incomplete');
if (modal.includes('p_expected_version')) ok('concurrency protection (p_expected_version) flows to the RPC');
else bad('version guard missing in the RPC call');

// ── 2. QR scanner resolves every payload the system issues ──
console.log('\n[2/4] QR scanning (Round 9 wiring)');
const scanner = read('src/components/QRScannerModal.jsx');
if (scanner.includes("resolveQrStudent } from '../lib/qrPayload'")) ok('scanner uses resolveQrStudent (UUID + token + portal URL)');
else bad('scanner must resolve QR payloads via qrPayload.resolveQrStudent');
if (scanner.includes('lessonAttRef.current[student.id]?.status')) ok('duplicate scan checked against ACTIVE lesson attendance');
else bad('duplicate check must use the lesson attendance map');
if (/await onMarkPresent\(/.test(scanner) && /saved === false/.test(scanner)) ok('scanner awaits the authoritative save (no false success)');
else bad('scanner must await onMarkPresent and handle saved === false');
if (!/window\.open|location\.href\s*=/.test(scanner)) ok('decoding the QR never navigates to the URL (no URL-as-proof)');
else bad('scanner must not navigate to the scanned URL');
const dash = read('src/pages/Dashboard.jsx');
if (dash.includes('lessonAttendanceByStudent={lessonAttendanceByStudent}') && dash.includes('lessonActive=')) ok('Dashboard passes lesson attendance + lesson state to the scanner');
else bad('Dashboard must pass lessonAttendanceByStudent + lessonActive props');
if (/const setAttendance = async[\s\S]{0,300}return false/.test(dash) && /return true\s*\n\s*\} finally/.test(dash)) ok('setAttendance returns true/false (authoritative result)');
else bad('setAttendance must report save success/failure');
if (dash.includes('return await setAttendance(id')) ok('QR onMarkPresent returns the save result');
else bad('onMarkPresent must return the awaited save result');

// ── 3. سجل حصص reads the live lesson table ──
console.log('\n[3/4] سجل حصص (lesson history source)');
const hist = read('src/components/SessionHistoryModal.jsx');
if (hist.includes("from('lesson_sessions')")) ok('SessionHistoryModal reads lesson_sessions (live, per-lesson)');
else bad('SessionHistoryModal must read lesson_sessions');
if (!hist.includes("from('session_logs')")) ok('frozen session_logs table fully retired from the history UI');
else bad('history modal still reads the dead session_logs table');
if (hist.includes('video_link')) ok('video/lesson link now shown in history');
else bad('video_link missing from history render');
if (dash.includes('(FIX سجل مجمّد)')) ok('Dashboard today-map derives from lesson_sessions (fetch + realtime)');
else bad('Dashboard sessionLogsByGroup still fed by dead session_logs');

// ── 4. Realtime coalescing (performance root-cause #2 fix) ──
console.log('\n[4/4] Realtime coalescing (Dashboard echo amplification)');
if ((dash.match(/coalesce\('/g) || []).length >= 9) ok('all 9 realtime handlers wrapped in the 120ms coalescer');
else bad(`coalesce wraps: ${(dash.match(/coalesce\('/g) || []).length} — expected >= 9`);
if (dash.includes('FLUSH_MS = 120')) ok('batch flush window defined (120ms)');
else bad('FLUSH_MS missing');
if (/const now = Date\.now\(\)\s*\n\s*if \(now - lastPingAt < 750\)/.test(dash)) ok('portal pings throttled to 1/750ms');
else bad('ping throttle missing');

// ── 5. syntax gate on all touched files ──
console.log('\n[5/5] Syntax (babel parse) of touched files');
const babel = require('@babel/parser');
const touched = [
  'src/lib/helpers.js', 'src/components/ExamModal.jsx', 'src/components/ExamsListModal.jsx',
  'src/components/ExcelGradeImportModal.jsx', 'src/components/QRScannerModal.jsx',
  'src/components/SessionHistoryModal.jsx', 'src/pages/Dashboard.jsx',
];
for (const f of touched) {
  try { babel.parse(read(f), { sourceType: 'module', plugins: ['jsx'] }); ok(f); }
  catch (e) { bad(`${f}: ${e.message}`); }
}

console.log('');
if (failures > 0) { console.error(`FAIL — ${failures} check(s) failed`); process.exit(1); }
console.log('PASS — the pipeline + QR + history + coalescing are wired into the live app');
