#!/usr/bin/env python3
"""Watch the latest Vercel deployment for the Alnokhba project until it finishes.
Reads token from /home/z/my-project/.secrets/vercel-token (never prints it)."""
import json, sys, time, urllib.request

TOKEN = open("/home/z/my-project/.secrets/vercel-token").read().strip()
API = "https://api.vercel.com"


def get(path):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    # 1) find project
    projects = get("/v9/projects?limit=20")["projects"]
    if not projects:
        print("NO PROJECTS VISIBLE"); sys.exit(1)
    proj = None
    for p in projects:
        name = p.get("name", "")
        if "nokhb" in name.lower():
            proj = p; break
    if proj is None:
        proj = projects[0]
    pid, pname = proj["id"], proj["name"]
    print(f"project: {pname} ({pid[:8]}...)  framework={proj.get('framework')}")

    # 2) baseline: newest deployment uid right after push
    d = get(f"/v6/deployments?projectId={pid}&limit=5&target=production")
    deps = d["deployments"]
    now_ms = int(time.time() * 1000)
    fresh = [x for x in deps if now_ms - x["createdAt"] < 20 * 60 * 1000]
    if not fresh:
        print("NO FRESH DEPLOYMENT YET; latest overall:")
        for x in deps[:3]:
            print("  ", x.get("uid", "")[:12], x.get("state"), x.get("url"), time.strftime("%H:%M:%S", time.gmtime(x["createdAt"] / 1000)))
        sys.exit(2)
    dep = fresh[0]
    uid = dep["uid"]
    print(f"watching deployment {uid[:12]} url={dep.get('url')}")

    # 3) poll until terminal state (max ~8.5 min inside this run)
    deadline = time.time() + 510
    last = None
    while time.time() < deadline:
        cur = get(f"/v13/deployments/{uid}")
        state = cur.get("state")
        rdy = cur.get("readyState")
        sig = f"{state}/{rdy}"
        if sig != last:
            print(f"  [{time.strftime('%H:%M:%S')}] state={sig}")
            last = sig
        if rdy in ("READY", "ERROR") or state in ("READY", "ERROR", "CANCELED"):
            print("FINAL:", json.dumps({
                "uid": uid, "state": state, "readyState": rdy,
                "url": "https://" + cur.get("url", ""),
                "commit": (cur.get("meta") or {}).get("githubCommitSha", "")[:12],
                "created": time.strftime("%H:%M:%S", time.gmtime(cur["createdAt"] / 1000)),
            }, ensure_ascii=False))
            sys.exit(0 if (rdy == "READY" or state == "READY") else 3)
        time.sleep(15)
    print("TIMEOUT still", last)
    sys.exit(4)


if __name__ == "__main__":
    main()
