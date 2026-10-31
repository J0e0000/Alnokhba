#!/usr/bin/env python3
"""Task 42: watch Vercel for the 4dec6e71 deployment and report status."""
import json
import os
import sys
import time
import urllib.request

SHA_PREFIX = "4dec6e71"
TOKEN_PATH = "/home/z/my-project/.secrets/vercel-token"
TEAM_ID = None  # filled from token file dir if team file exists


def load_token() -> str:
    return open(TOKEN_PATH).read().strip()


def get_deployments(token: str):
    url = "https://api.vercel.com/v6/deployments?limit=10&project=frontend-alfares"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    token = load_token()
    deadline = time.time() + 420
    seen = 0
    while time.time() < deadline:
        try:
            data = get_deployments(token)
            deps = data.get("deployments", [])
            for d in deps:
                sha = (d.get("meta") or {}).get("githubCommitSha", "")[:8]
                if sha == SHA_PREFIX:
                    state = d.get("readyState") or d.get("state")
                    uid = d.get("uid")
                    print(f"found deploy {uid} sha={sha} state={state}", flush=True)
                    if state == "READY":
                        print(f"LIVE: https://al-nokhbba.vercel.app (dpl {uid})")
                        return 0
                    if state in ("ERROR", "CANCELED"):
                        print(f"DEPLOY FAILED: {state}")
                        return 1
                    break
            else:
                seen += 1
                print(f"waiting for {SHA_PREFIX}... ({seen})", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"poll error: {exc}", flush=True)
        time.sleep(20)
    print("TIMEOUT waiting for deployment")
    return 1


if __name__ == "__main__":
    sys.exit(main())
