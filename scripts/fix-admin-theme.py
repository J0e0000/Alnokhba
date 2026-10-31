#!/usr/bin/env python3
"""One-shot theme-token migration for remaining admin components.
Ordered literal replacements + guarded text-brand-navy (never on gold buttons)."""
import re, sys

FILES = [
    "/home/z/my-project/src/components/AdminBackupsPanel.jsx",
    "/home/z/my-project/src/components/AdminSupportAccessModal.jsx",
]

# (old, new) applied in order — specific patterns before generic ones
REPLACEMENTS = [
    # ── explicit multi-class combos first ──
    ("bg-emerald-50/60 border-emerald-100", "bg-[var(--ok-bg)] border-[var(--ok-border)]"),
    ("bg-emerald-50 border border-emerald-200", "bg-[var(--ok-bg)] border border-[var(--ok-border)]"),
    ("bg-emerald-100 text-emerald-700", "bg-[var(--ok-bg)] text-[var(--ok-strong)]"),
    ("bg-amber-50 border-2 border-amber-300", "bg-[var(--warn-bg)] border-2 border-[var(--warn-border)]"),
    ("bg-amber-50 border border-amber-200", "bg-[var(--warn-bg)] border border-[var(--warn-border)]"),
    ("bg-amber-100 text-amber-700", "bg-[var(--warn-bg)] text-[var(--warn-strong)]"),
    ("hover:bg-amber-100", "hover:bg-[var(--warn-bg)]"),
    ("bg-amber-600 hover:bg-amber-500", "bg-amber-700 hover:bg-amber-600"),
    ("bg-rose-50 border border-rose-200", "bg-[var(--danger-bg)] border border-[var(--danger-border)]"),
    ("bg-rose-100 text-rose-700", "bg-[var(--danger-bg)] text-[var(--danger-strong)]"),
    ("bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100", "bg-[var(--info-bg)] border border-[var(--info-border)] text-[var(--info-strong)] hover:opacity-90"),
    # semantic text colors (hover variants before plain)
    ("text-emerald-600 hover:text-emerald-500", "text-[var(--ok-strong)] hover:opacity-75"),
    ("text-violet-600 hover:text-violet-500", "text-[var(--info-strong)] hover:opacity-75"),
    ("text-rose-600 hover:text-rose-500", "text-[var(--danger-strong)] hover:opacity-75"),
    ("text-rose-400 hover:text-rose-600", "text-[var(--danger)] hover:text-[var(--danger-strong)]"),
    ("text-emerald-700", "text-[var(--ok-strong)]"),
    ("text-emerald-600", "text-[var(--ok-strong)]"),
    ("text-emerald-500", "text-[var(--ok)]"),
    ("text-amber-800", "text-[var(--warn-strong)]"),
    ("text-amber-700", "text-[var(--warn-strong)]"),
    ("text-amber-600", "text-[var(--warn-strong)]"),
    ("text-rose-700", "text-[var(--danger-strong)]"),
    ("text-rose-600", "text-[var(--danger-strong)]"),
    ("text-violet-700", "text-[var(--info-strong)]"),
    ("text-violet-600", "text-[var(--info-strong)]"),
    ("text-violet-500", "text-[var(--info)]"),
    # remaining pastel bgs / borders
    ("bg-amber-50", "bg-[var(--warn-bg)]"),
    ("border-amber-300", "border-[var(--warn-border)]"),
    ("border-amber-200", "border-[var(--warn-border)]"),
    ("border-rose-200", "border-[var(--danger-border)]"),
    ("border-violet-200", "border-[var(--info-border)]"),
    ("bg-violet-50", "bg-[var(--info-bg)]"),
    ("bg-violet-100", "bg-[var(--info-bg)]"),
    # solid emerald primary buttons → bump contrast (white text ≥4.5:1)
    ("bg-emerald-600 hover:bg-emerald-500", "bg-emerald-700 hover:bg-emerald-600"),
    # slate family
    ("hover:bg-slate-50/60", "hover:bg-surface-container"),
    ("hover:bg-slate-50", "hover:bg-surface-container"),
    ("hover:bg-slate-200", "hover:bg-surface-container-highest"),
    ("border-slate-200", "border-outline"),
    ("border-slate-100", "border-outline"),
    ("border-slate-300", "border-outline"),
    ("divide-slate-100", "divide-outline"),
    ("divide-slate-200", "divide-outline"),
    ("bg-slate-100 text-slate-500", "bg-surface-container-high text-fg-muted"),
    ("bg-slate-100 text-slate-600", "bg-surface-container-high text-fg"),
    ("bg-slate-50", "bg-surface-container"),
    ("bg-slate-100", "bg-surface-container-high"),
    ("text-slate-400", "text-fg-subtle"),
    ("text-slate-500", "text-fg-muted"),
    ("text-slate-600", "text-fg-muted"),
    ("text-slate-700", "text-fg"),
    ("text-slate-800", "text-fg"),
    # hardcoded white cards → theme surface token
    ("bg-white/90", "bg-surface"),
    ("bg-white", "bg-surface"),
    # border-color-as-text misuse → real muted fg (7:1 both themes)
    ("text-outline", "text-fg-muted"),
]

# text-brand-navy is correct ONLY on gold surfaces; replace elsewhere
def fix_brand_navy(s):
    out, idx, count = [], 0, 0
    while True:
        i = s.find("text-brand-navy", idx)
        if i == -1:
            out.append(s[idx:])
            break
        window = s[max(0, i - 120):i]
        if "bg-brand-gold" in window:
            out.append(s[idx:i + len("text-brand-navy")])  # keep
        else:
            out.append(s[idx:i])
            out.append("text-fg")
            count += 1
        idx = i + len("text-brand-navy")
    return "".join(out), count

for path in FILES:
    src = open(path, encoding="utf-8").read()
    counts = {}
    for old, new in REPLACEMENTS:
        n = src.count(old)
        if n:
            src = src.replace(old, new)
            counts[old] = n
    src, navy = fix_brand_navy(src)
    open(path, "w", encoding="utf-8").write(src)
    print(f"== {path.split('/')[-1]}: {sum(counts.values())} literal replacements, {navy} brand-navy→text-fg")
    for k, v in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"   {v:2d}× {k}")
