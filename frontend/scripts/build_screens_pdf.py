#!/usr/bin/env python3
"""Build the Alnokhba website-tour PDF from screenshots.
Light/Process route: images -> styled A4 pages -> single PDF + metadata."""
import os
from PIL import Image, ImageDraw, ImageFont

SHOTS = "/home/z/my-project/download/shots"
OUT_PDF = "/home/z/my-project/download/Alnokhba-Website-Tour.pdf"
TMP = "/home/z/my-project/scripts/pdf_pages"
os.makedirs(TMP, exist_ok=True)

W, H = 1240, 1754  # A4 @150dpi portrait
NAVY = (14, 41, 84)
GOLD = (212, 163, 115)
INK = (30, 41, 59)
MUTED = (100, 116, 139)
BG = (248, 250, 252)
LINE = (226, 232, 240)

F = "/usr/share/fonts/truetype/dejavu/"
f_title = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 58)
f_sub = ImageFont.truetype(F + "DejaVuSans.ttf", 26)
f_h2 = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 30)
f_head = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 27)
f_sec = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 20)
f_foot = ImageFont.truetype(F + "DejaVuSans.ttf", 17)
f_toc = ImageFont.truetype(F + "DejaVuSans.ttf", 24)
f_tocb = ImageFont.truetype(F + "DejaVuSans-Bold.ttf", 24)

PAGES = [
    ("01-landing-hero.png", "PUBLIC SITE", "Landing page — hero", "Live on https://al-nokhbba.vercel.app"),
    ("01-landing-full.png", "PUBLIC SITE", "Landing page — every section (full page)", "Live · full-page capture"),
    ("02-login.png", "PUBLIC SITE", "Login", "Live · real Supabase auth"),
    ("03-privacy.png", "PUBLIC SITE", "Privacy policy (/privacy) — new page", "Live · full-page capture"),
    ("04-qr-invalid.png", "PUBLIC SITE", "Student portal — invalid/expired link state", "Live · graceful Arabic error"),
    ("05-tutorial-firsthint.png", "ONBOARDING", "First-visit tutorial hint", "Demo build"),
    ("06-home-top.png", "DASHBOARD", "Home — stats, attention banner, day timeline", "Demo build"),
    ("06b-home-full.png", "DASHBOARD", "Home — full page", "Demo build · full-page capture"),
    ("07-workspace-attendance.png", "SESSION WORKSPACE", "Tab 1 — Attendance (live counters)", "Demo build"),
    ("08-workspace-homework.png", "SESSION WORKSPACE", "Tab 2 — Interaction & homework", "Demo build"),
    ("09-workspace-exams.png", "SESSION WORKSPACE", "Tab 3 — Exams, scores & corrections", "Demo build"),
    ("10-workspace-review.png", "SESSION WORKSPACE", "Tab 4 — Review before closing", "Demo build"),
    ("11-workspace-report.png", "SESSION WORKSPACE", "Tab 5 — Report & finish session (full)", "Demo build · full-page capture"),
    ("12-students-list.png", "STUDENTS", "Students — rows, filters, quick actions", "Demo build"),
    ("13-students-qr-modal.png", "STUDENTS", "Student QR modal — visible link, copy, WhatsApp, QR download (NEW)", "Demo build · the fixed QR surface"),
    ("14-students-profile-modal.png", "STUDENTS", "Student profile modal — opens on name click", "Demo build"),
    ("15-history-record.png", "HISTORY", "Student history — read-only record (full)", "Demo build · full-page capture"),
    ("16-reports.png", "REPORTS", "Reports — group/lesson picker, CSV export (gated)", "Demo build"),
    ("16b-reports-qr-queue.png", "REPORTS", "Reports — portal-links (QR) queue modal", "Demo build · messages always carry the link"),
    ("17-analytics.png", "ANALYTICS", "Analytics — 30-day period chip + insights", "Demo build"),
    ("17b-analytics-alltime.png", "ANALYTICS", "Analytics — all-time period", "Demo build"),
    ("17c-analytics-summary-csv.png", "ANALYTICS", "Per-student period summary + CSV export (NEW)", "Demo build"),
    ("18-settings-modal.png", "SETTINGS", "Settings — QR message template now shows {link}", "Demo build"),
    ("19-help-area.png", "HELP", "Help center / FAQ (full)", "Demo build · full-page capture"),
    ("20-global-search.png", "TOOLS", "Global search overlay", "Demo build"),
    ("21-dark-home.png", "DARK MODE", "Home — dark theme", "Demo build"),
    ("21b-dark-students.png", "DARK MODE", "Students — dark theme", "Demo build"),
    ("22-portal-top.png", "STUDENT PORTAL", "Portal — student header, status, entry state", "Demo token (preview build)"),
    ("23-portal-qr-section.png", "STUDENT PORTAL", "Portal — QR + visible URL + copy + share + download (NEW)", "Demo token (preview build)"),
    ("24-portal-sessions.png", "STUDENT PORTAL", "Portal — sessions as separate cards", "Demo token (preview build)"),
    ("24b-portal-bottom.png", "STUDENT PORTAL", "Portal — homework, exams, announcements (full)", "Demo token (preview build)"),
    ("25-mobile-home.png", "MOBILE 390px", "Mobile — home", "Demo build · 390×844"),
    ("26-mobile-students.png", "MOBILE 390px", "Mobile — students", "Demo build · 390×844"),
    ("27-mobile-history.png", "MOBILE 390px", "Mobile — history", "Demo build · 390×844"),
    ("28-mobile-workspace.png", "MOBILE 390px", "Mobile — session workspace", "Demo build · 390×844"),
    ("29-mobile-portal.png", "MOBILE 390px", "Mobile — student portal", "Demo token (preview build) · 390×844"),
]

SECTIONS = []
for _, sec, _, _ in PAGES:
    if not SECTIONS or SECTIONS[-1][0] != sec:
        SECTIONS.append([sec, 0])
    SECTIONS[-1][1] += 1


def text_w(d, s, f):
    b = d.textbbox((0, 0), s, font=f)
    return b[2] - b[0]


def cover_page():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 14], fill=NAVY)
    d.rectangle([0, 14, W, 20], fill=GOLD)
    d.text((80, 120), "Alnokhba Edu", font=f_title, fill=NAVY)
    d.text((80, 205), "Website Tour — every page & section, screenshot by screenshot", font=f_sub, fill=INK)
    d.text((80, 245), "al-nokhbba.vercel.app  ·  September 19, 2026", font=f_sub, fill=MUTED)
    d.line([80, 300, W - 80, 300], fill=LINE, width=3)
    d.text((80, 330), "Contents", font=f_h2, fill=NAVY)
    y = 385
    for i, (sec, cnt) in enumerate(SECTIONS, 1):
        d.text((80, y), f"{i:02d}", font=f_tocb, fill=GOLD)
        d.text((140, y), sec.title(), font=f_tocb, fill=INK)
        d.text((W - 80 - text_w(d, f"{cnt} pages", f_toc), y), f"{cnt} pages", font=f_toc, fill=MUTED)
        y += 44
    y += 30
    d.line([80, y, W - 80, y], fill=LINE, width=3)
    y += 26
    notes = [
        "PUBLIC SITE pages were captured live from https://al-nokhbba.vercel.app after today's deploy.",
        "Authenticated screens (dashboard, workspace, students, reports, analytics, settings, portal",
        "with data) were captured from a demo-data build of the same production bundle — the UI is",
        "identical to production; production simply needs your real login.",
        "NEW tags mark surfaces added in today's deploy: QR modal with visible link, portal URL +",
        "share, privacy page, analytics period filters and CSV exports.",
    ]
    for n in notes:
        d.text((80, y), n, font=f_toc, fill=MUTED)
        y += 38
    d.rectangle([0, H - 20, W, H], fill=NAVY)
    im.save(f"{TMP}/p000.jpg", "JPEG", quality=88)
    return im


def slice_fitted(img, max_w, max_h):
    """Fit image to max_w; if taller than max_h, slice into vertical parts."""
    scale = max_w / img.width
    fitted_h = int(img.height * scale)
    if fitted_h <= max_h:
        return [(img.resize((max_w, fitted_h), Image.LANCZOS), None)]
    n = -(-fitted_h // max_h)  # ceil
    seg = img.height / n
    parts = []
    for i in range(n):
        top, bot = int(i * seg), int(min(img.height, (i + 1) * seg + 8))
        part = img.crop((0, top, img.width, bot))
        ph = int(part.height * scale)
        parts.append((part.resize((max_w, ph), Image.LANCZOS), f"part {i+1}/{n}" if n > 1 else None))
    return parts


def build_page(idx, fname, sec, title, note, page_no, part_no=None, total_pages=None):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 76], fill=NAVY)
    d.rectangle([0, 76, W, 82], fill=GOLD)
    d.text((40, 24), sec, font=f_sec, fill=GOLD)
    t = title if not part_no else f"{title} ({part_no})"
    tw = text_w(d, t, f_head)
    d.text((W - 40 - tw, 22), t, font=f_head, fill=(255, 255, 255))

    top, bottom = 110, H - 56
    max_w, max_h = W - 80, bottom - top
    src = Image.open(os.path.join(SHOTS, fname)).convert("RGB")
    if src.width <= 500:  # mobile portrait — fit height, cap upscale
        scale = min(max_h / src.height, max_w / src.width, 2.2)
        fitted = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)
        parts = [(fitted, None)]
    else:
        parts = slice_fitted(src, max_w, max_h)

    fit, part_label = parts[part_no - 1 if part_no else 0]
    x = (W - fit.width) // 2
    y = top + max(0, (max_h - fit.height) // 3)
    d.rectangle([x - 2, y - 2, x + fit.width + 2, y + fit.height + 2], outline=LINE, width=2)
    im.paste(fit, (x, y))

    d.text((40, H - 46), note, font=f_foot, fill=MUTED)
    pn = f"Page {page_no}" + (f" · {part_label}" if part_label else "")
    d.text((W - 40 - text_w(d, pn, f_foot), H - 46), pn, font=f_foot, fill=MUTED)
    d.text((40, H - 46 + 0), note, font=f_foot, fill=MUTED)
    out = f"{TMP}/p{page_no:03d}{'x' + str(part_no) if part_no else ''}.jpg"
    im.save(out, "JPEG", quality=88)


def main():
    cover_page()
    page_no = 2
    for i, (fname, sec, title, note) in enumerate(PAGES):
        src_path = os.path.join(SHOTS, fname)
        src = Image.open(src_path)
        if src.width <= 500:
            build_page(i, fname, sec, title, note, page_no)
            page_no += 1
        else:
            parts = slice_fitted(src, W - 80, H - 110 - 56)
            for j in range(len(parts)):
                build_page(i, fname, sec, title, note, page_no, part_no=j + 1 if len(parts) > 1 else None)
                page_no += 1

    pages = [Image.open(os.path.join(TMP, f)) for f in sorted(os.listdir(TMP))]
    pages[0].save(OUT_PDF, save_all=True, append_images=pages[1:], resolution=150.0, title="Alnokhba Edu — Website Tour", author="Z.ai")
    print(f"PDF saved: {OUT_PDF} pages={len(pages)} size={os.path.getsize(OUT_PDF)//1024}KB")


if __name__ == "__main__":
    main()
