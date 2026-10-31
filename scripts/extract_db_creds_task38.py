#!/usr/bin/env python3
"""Task 38 — pull Supabase Postgres creds from Vercel env (alnokhba-db-probe),
verify they point at the SAME project as the live app, save connection string
to .secrets with chmod 600. NEVER prints passwords/JWTs — only hosts/shape."""
import base64, json, subprocess, sys, os

TOKEN = open('/home/z/my-project/.secrets/vercel-token').read().strip()
PROJ = 'prj_NIYNE8KPJlpxv43exkdiiGG3YtTf'

def fetch_env():
    out = subprocess.run(['curl', '-s', '-H', f'Authorization: Bearer {TOKEN}',
                          f'https://api.vercel.com/v9/projects/{PROJ}/env?decrypt=true'],
                         capture_output=True, text=True, timeout=60)
    data = json.loads(out.stdout)
    return {e['key']: e.get('value', '') for e in data.get('envs', [])}

def unwrap(v):
    """Vercel/Supabase integration values may be base64 JSON envelope or plain."""
    if not v:
        return None
    try:
        dec = base64.b64decode(v).decode('utf-8')
        obj = json.loads(dec)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    return None

envs = fetch_env()
print('fetched', len(envs), 'env vars')

# Understand the envelope using the non-secret SUPABASE_URL
raw = envs.get('SUPABASE_URL', '')
env_obj = unwrap(raw)
print('SUPABASE_URL envelope type:', type(env_obj).__name__)
if isinstance(env_obj, dict):
    print('envelope keys:', list(env_obj.keys()))
    for k, val in env_obj.items():
        if isinstance(val, str) and val.startswith('postgres'):
            print(f'  {k}: (postgres URL, len {len(val)})')
        elif isinstance(val, str) and val.startswith('https://'):
            print(f'  {k}: {val[:40]}...')
        elif isinstance(val, str) and len(val) > 40:
            print(f'  {k}: (str len {len(val)}, starts {val[:6]}...)')
        else:
            print(f'  {k}: {val}')
