#!/usr/bin/env python3
"""Secrets scan over all git objects + working tree. Masked output only."""
import re, subprocess, sys, os, hashlib

ROOT = '/home/z/my-project/audit/repo'

PATTERNS = [
    ("supabase_service_key", r'\bsb_secret_[A-Za-z0-9_-]{20,}'),
    ("supabase_service_role_jwt", r'\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'),
    ("resend_api_key", r'\bre_[A-Za-z0-9]{20,}'),
    ("github_pat", r'\bgithub_pat_[A-Za-z0-9_]{20,}'),
    ("github_token", r'\bgh[pousr]_[A-Za-z0-9]{30,}'),
    ("aws_access_key", r'\bAKIA[0-9A-Z]{16}\b'),
    ("google_api_key", r'\bAIza[0-9A-Za-z_-]{30,}'),
    ("openai_key", r'\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}'),
    ("slack_token", r'\bxox[baprs]-[A-Za-z0-9-]{15,}'),
    ("private_key_block", r'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    ("db_conn_string", r'postgres(?:ql)?:\/\/[a-zA-Z0-9_]+:[^@\s]{8,}@'),
    ("vercel_token", r'\b[A-Za-z0-9]{24}\b(?=(?:.*vercel))'),
    ("generic_secret_assign", r'(?:secret|password|passwd|token|api_key|apikey|private_key)["\']?\s*[:=]\s*["\'][A-Za-z0-9+/=_-]{24,}["\']'),
]

WHITELIST_HINTS = [
    'example', 'sample', 'placeholder', 'your-', 'xxxx', 'test', 'dummy',
    'eyJ', 'SIGNING_SECRET', 'RESEND_API_KEY', 'VITE_SUPABASE', 'process.env',
    'Deno.env', 'import.meta.env', 'changeme', 'redacted', 'mask',
]

def scan_text(text, source):
    hits = []
    for name, pat in PATTERNS:
        for m in re.finditer(pat, text):
            val = m.group(0)
            low_ctx = text[max(0, m.start()-80):m.end()+40].lower()
            if any(h.lower() in low_ctx or h.lower() in val.lower() for h in WHITELIST_HINTS):
                continue
            sha = hashlib.sha1(val.encode()).hexdigest()[:8]
            masked = val[:6] + '…' + val[-3:] if len(val) > 12 else val[:3] + '…'
            hits.append((name, source, masked, len(val), sha))
    return hits

def main():
    all_hits = []
    # 1) All git objects (every blob in full history)
    r = subprocess.run(['git', '-C', ROOT, 'cat-file', '--batch-all-objects', '--batch-check'],
                       capture_output=True, text=True)
    blobs = [line.split()[1] for line in r.stdout.splitlines() if line.split()[1:2] == ['blob']]
    print(f"scanning {len(blobs)} blobs across full git history...")
    batch, done = [], 0
    for b in blobs:
        batch.append(b)
        if len(batch) >= 500:
            data = subprocess.run(['git', '-C', ROOT, 'cat-file', '--batch'] , input='\n'.join(batch)+'\n',
                                  capture_output=True, text=True, errors='ignore')
            all_hits += scan_text(data.stdout, 'git-history-blob-batch')
            done += len(batch); batch = []
    if batch:
        data = subprocess.run(['git', '-C', ROOT, 'cat-file', '--batch'], input='\n'.join(batch)+'\n',
                              capture_output=True, text=True, errors='ignore')
        all_hits += scan_text(data.stdout, 'git-history-blob-batch')
        done += len(batch)
    # 2) Working tree (tracked files)
    files = subprocess.run(['git', '-C', ROOT, 'ls-files'], capture_output=True, text=True).stdout.split()
    for f in files:
        p = os.path.join(ROOT, f)
        try:
            if os.path.getsize(p) > 2_000_000: continue
            all_hits += scan_text(open(p, encoding='utf-8', errors='ignore').read(), f'worktree:{f}')
        except Exception:
            pass
    # dedupe
    seen, uniq = set(), []
    for h in all_hits:
        k = (h[0], h[4])
        if k not in seen:
            seen.add(k); uniq.append(h)
    print(f"\n== UNIQUE HITS: {len(uniq)} ==")
    for name, src, masked, ln, sha in uniq:
        print(f"[{name}] len={ln} sha1={sha} where={src} value={masked}")
    if not uniq:
        print("CLEAN — no secret patterns matched outside whitelists")

main()
