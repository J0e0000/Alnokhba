#!/usr/bin/env python3
"""Multi-group rollout: swap student-membership filters to studentInGroup()
and wire its import in every consumer file. Prints per-file replacement
counts; aborts (non-zero) if an expected pattern is missing so drift is loud.
"""
import re, sys, pathlib

ROOT = pathlib.Path('/home/z/my-project/frontend')

# file → list of (exact_old, exact_new) — session-row filters (l.group_name /
# lesson.group_name / engine.js line with s=SESSION) are deliberately absent.
JOBS = {
    'src/lib/insights/engine.js': [
        ('students.filter((s) => s.group_name === group)', 'students.filter((s) => studentInGroup(s, group))'),
    ],
    'src/lib/reportBuilders.js': [
        ('(students || []).filter((s) => s.group_name === groupName)', '(students || []).filter((s) => studentInGroup(s, groupName))'),
    ],
    'src/session/tabs/AttendanceTab.jsx': [
        ('(ws.archivedStudents || []).filter((s) => s.group_name === groupId)', '(ws.archivedStudents || []).filter((s) => studentInGroup(s, groupId))'),
    ],
    'src/components/ReportStudioModal.jsx': [
        ('ws.students.filter((s) => s.group_name === group)', 'ws.students.filter((s) => studentInGroup(s, group))'),
    ],
    'src/exams/ExamWorkspace.jsx': [
        ('(s) => s.group_name === groupName', '(s) => studentInGroup(s, groupName)'),
        ('(s) => s.group_name === g', '(s) => studentInGroup(s, g)'),
        ('(s) => s.group_name === exam.group_name', '(s) => studentInGroup(s, exam.group_name)'),
    ],
    'src/exams/OnlineExamWorkspace.jsx': [
        ('(s) => s.group_name === exam.group_name', '(s) => studentInGroup(s, exam.group_name)'),
    ],
    'src/homework/HomeworkWorkspace.jsx': [
        ('(s) => s.group_name === groupName', '(s) => studentInGroup(s, groupName)'),
        ('(s) => s.group_name === task.group_name', '(s) => studentInGroup(s, task.group_name)'),
    ],
    'src/home/HomePage.jsx': [
        ('(s) => s.group_name === groupName', '(s) => studentInGroup(s, groupName)'),
        ('(s) => s.group_name === task.group_name', '(s) => studentInGroup(s, task.group_name)'),
        ('(s) => s.group_name === exam.group_name', '(s) => studentInGroup(s, exam.group_name)'),
    ],
    'src/areas/HomeworkArea.jsx': [
        ('(s) => s.group_name === t.group_name', '(s) => studentInGroup(s, t.group_name)'),
    ],
    'src/areas/ReportsArea.jsx': [
        ('(s) => s.group_name === group', '(s) => studentInGroup(s, group)'),
    ],
}

IMPORT_RE = re.compile(r"import\s*\{([^}]+)\}\s*from\s*'(.*?)'")

def correct_helpers_specifier(rel):
    """Correct relative specifier for src/lib/helpers.js from a src/**/file."""
    dirs = rel.replace('src/', '').count('/')
    return ('../' * dirs) + 'lib/helpers'

def normalize_helpers_import(text, rel):
    """Repair any helpers import whose specifier doesn't resolve."""
    good = correct_helpers_specifier(rel)
    fixed = 0
    def _fix(m):
        nonlocal fixed
        names, src = m.group(1), m.group(2)
        if not src.endswith('helpers'):
            return m.group(0)
        # does the current specifier resolve to src/lib/helpers.js?
        base = pathlib.PurePosixPath(rel).parent
        try:
            resolved = (base / pathlib.PurePosixPath(src)).resolve()
            ok = str(resolved).endswith('src/lib/helpers.js') or str(resolved).endswith('frontend/src/lib/helpers.js')
        except Exception:
            ok = False
        if ok:
            return m.group(0)
        fixed += 1
        return f"import {{{names}}} from '{good}'"
    return IMPORT_RE.sub(_fix, text), fixed

def wire_import(text, rel):
    if re.search(r"\bstudentInGroup\b\s*,|\bstudentInGroup\b\s*\}", text) and "studentInGroup" in text.split('export')[0]:
        pass  # may already be there
    # find an existing import from a helpers module
    for m in IMPORT_RE.finditer(text):
        src = m.group(2)
        if src.endswith('helpers'):
            names = [n.strip() for n in m.group(1).split(',')]
            if 'studentInGroup' not in names:
                names.append('studentInGroup')
                new_import = f"import {{ {', '.join(names)} }} from '{src}'"
                return text[:m.start()] + new_import + text[m.end():], 'extended'
            return text, 'already'
    # no helpers import → append one right after the last import statement
    rel_import = rel.replace('src/', '')
    depth = rel_import.count('/')
    prefix = './' if depth == 0 else '../' * depth
    line = f"import {{ studentInGroup }} from '{prefix}lib/helpers'\n"
    last = 0
    for m in IMPORT_RE.finditer(text):
        last = m.end()
    eol = text.find('\n', last)
    eol = len(text) if eol == -1 else eol + 1
    return text[:eol] + line + text[eol:], 'added'

failed = []
for rel, pairs in JOBS.items():
    p = ROOT / rel
    text = p.read_text(encoding='utf-8')
    text, fixed_imports = normalize_helpers_import(text, rel)
    if fixed_imports:
        print(f"{rel}: repaired {fixed_imports} broken helpers import(s)")
    counts = []
    for old, new in pairs:
        n = text.count(old)
        counts.append(f"{n}x")
        if n == 0:
            failed.append(f"{rel}: pattern missing: {old}")
            continue
        text = text.replace(old, new)
    text, how = wire_import(text, rel)
    p.write_text(text, encoding='utf-8')
    print(f"{rel}: {' | '.join(counts)} replacements, import {how}")

if failed:
    print('FAILURES:'); [print(' -', f) for f in failed]
    sys.exit(1)
print('ALL OK')
