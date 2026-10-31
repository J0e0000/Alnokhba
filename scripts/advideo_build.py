#!/usr/bin/env python3
"""Build the Alnokhba 16:9 ad video (1920x1080@30, ~27s) from the six ad
screenshots + rendered brand/kinetic cards. Ken Burns motion via zoompan,
hand-cursor overlay on two scenes, chained xfade transitions.
Output: /home/z/my-project/download/alnokhba-ad-video-16x9.mp4
"""
import os
import subprocess

SHOTS = "/home/z/my-project/download/ad-screenshots/16x9"
CARDS = "/home/z/my-project/adwork/video/cards"
OUTDIR = "/home/z/my-project/adwork/video/seg"
FINAL = "/home/z/my-project/download/alnokhba-ad-video-16x9.mp4"
os.makedirs(OUTDIR, exist_ok=True)
FPS = 30
FD = 0.4  # xfade duration

# (id, source path, duration_s, motion)  motion: zoomin/zoomout Z0->Z1, pandown
SEGMENTS = [
    ("intro",     f"{CARDS}/card-intro.png",        2.8, ("zoomin", 1.00, 1.05, False)),
    ("k1",        f"{CARDS}/card-k1.png",           1.0, ("zoomin", 1.00, 1.06, False)),
    ("dashboard", f"{SHOTS}/01-dashboard-16x9.png", 4.0, ("zoomin", 1.00, 1.10, False)),
    ("k2",        f"{CARDS}/card-k2.png",           1.0, ("zoomin", 1.00, 1.06, False)),
    ("students",  f"{SHOTS}/05-students-16x9.png",  4.0, ("pandown", 1.25, 1.25, False)),
    ("k3",        f"{CARDS}/card-k3.png",           1.1, ("zoomin", 1.00, 1.06, False)),
    ("reports",   f"{SHOTS}/02-reports-16x9.png",   3.2, ("zoomin", 1.00, 1.12, False)),
    ("insights",  f"{SHOTS}/06-insights-16x9.png",  3.2, ("zoomout", 1.12, 1.00, False)),
    ("hero",      f"{SHOTS}/03-hero-16x9.png",      3.6, ("zoomin", 1.00, 1.08, False)),
    ("mobile",    f"{SHOTS}/04-mobile-16x9.png",    3.0, ("zoomout", 1.10, 1.00, False)),
    ("k4",        f"{CARDS}/card-k4.png",           1.3, ("zoomin", 1.00, 1.07, False)),
    ("outro",     f"{CARDS}/card-outro.png",        3.2, ("zoomin", 1.00, 1.04, False)),
]
CURSOR_SCENES = {
    "dashboard": ("x='1180-50*t'", "y='820-65*t'"),
    "students":  ("x='1060'",      "y='640+150*t'"),
}

def build_segment(idx, sid, src, dur, motion):
    out = f"{OUTDIR}/{idx:02d}-{sid}.mp4"
    n = round(dur * FPS)
    kind, z0, z1, _ = motion
    if kind == "pandown":
        zexpr = f"{z0}"
        xexpr = "iw/2-(iw/zoom/2)"
        yexpr = f"(ih-ih/zoom)*(0.06+0.58*in/{n-1})"
    elif kind == "zoomout":
        zexpr = f"{z1}+({z0}-{z1})*in/{n-1}"
        xexpr = "iw/2-(iw/zoom/2)"
        yexpr = "ih/2-(ih/zoom/2)"
    else:  # zoomin
        zexpr = f"{z0}+({z1}-{z0})*in/{n-1}"
        xexpr = "iw/2-(iw/zoom/2)"
        yexpr = "ih/2-(ih/zoom/2)"
    vf = (f"scale=3840:2160:flags=lanczos,"
          f"zoompan=z='{zexpr}':x='{xexpr}':y='{yexpr}':d=1:s=1920x1080:fps={FPS},"
          f"setsar=1,format=yuv420p")
    if sid in CURSOR_SCENES:
        cx, cy = CURSOR_SCENES[sid]
        cmd = ["ffmpeg", "-y", "-framerate", str(FPS), "-loop", "1", "-t", str(dur), "-i", src,
               "-framerate", str(FPS), "-loop", "1", "-t", str(dur), "-i", f"{CARDS}/cursor.png",
               "-filter_complex",
               f"[0:v]{vf}[base];[1:v]scale=110:110[c];[base][c]overlay={cx}:{cy}:eval=frame,setsar=1,format=yuv420p[v]",
               "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "17",
               "-r", str(FPS), "-an", out]
    else:
        cmd = ["ffmpeg", "-y", "-framerate", str(FPS), "-loop", "1", "-t", str(dur), "-i", src,
               "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "17",
               "-r", str(FPS), "-an", out]
    subprocess.run(cmd, check=True, capture_output=True)
    print("segment ok:", sid)

# ---- Pass 1: segments ----
for i, (sid, src, dur, motion) in enumerate(SEGMENTS):
    build_segment(i, sid, src, dur, motion)

# ---- Pass 2: xfade chain ----
n_seg = len(SEGMENTS)
trans = ["fade"] * (n_seg - 1)
trans[7] = "slideleft"  # hero entry, mirrors their slide transition

inputs = []
for i, (sid, src, dur, _) in enumerate(SEGMENTS):
    inputs += ["-i", f"{OUTDIR}/{i:02d}-{sid}.mp4"]

fc, acc, prev_offset = [], None, None
for k in range(n_seg - 1):
    offset = (SEGMENTS[0][2] - FD) if k == 0 else (prev_offset + SEGMENTS[k][2] - FD)
    prev_offset = offset
    a = acc or "[0:v]"
    lbl = f"[x{k}]"
    fc.append(f"{a}[{k+1}:v]xfade=transition={trans[k]}:duration={FD}:offset={offset:.3f}{lbl}")
    acc = lbl
total = sum(s[2] for s in SEGMENTS) - FD * (n_seg - 1)
fc.append(f"{acc}fade=t=in:st=0:d=0.5,fade=t=out:st={total-0.7:.3f}:d=0.7,format=yuv420p[v]")

cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-r", str(FPS),
       "-movflags", "+faststart", "-an", FINAL]
subprocess.run(cmd, check=True, capture_output=True)
print("FINAL:", FINAL, f"{os.path.getsize(FINAL)/1e6:.1f} MB, {total:.1f}s")
