#!/bin/bash
# Alnokhba production deploy via Vercel CLI
# Usage: bash /home/z/my-project/scripts/deploy-vercel.sh <VERCEL_TOKEN>
# - Links to the EXISTING project that serves al-nokhbba.vercel.app (found via API)
# - Deploys frontend/ with the 3 required VITE_ env vars
# - Env values come from /tmp/zipx2/.env (recovered public frontend vars)
set -e
TOKEN="$1"
[ -z "$TOKEN" ] && { echo "ERROR: pass Vercel token as arg 1"; exit 1; }

FRONTEND_DIR=/home/z/my-project/alnokhba-push/frontend
API=https://api.vercel.com

echo "=== 1. FIND PROJECT OWNERSHIP (team scope) ==="
TEAMS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/v2/teams?limit=10")
echo "$TEAMS" | python3 -c "import json,sys; d=json.load(sys.stdin); [print('team:', t.get('slug'), t['id']) for t in d.get('teams',[])]" || true

echo "=== 2. LIST PROJECTS (user scope) ==="
curl -s -H "Authorization: Bearer $TOKEN" "$API/v9/projects?limit=20" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'projects' not in d: print('ERR:', d); sys.exit(1)
for p in d['projects']:
    print('project:', p.get('name'), '| id:', p.get('id'), '| latest:', (p.get('latestDeployments') or [{}])[0].get('url',''))"
