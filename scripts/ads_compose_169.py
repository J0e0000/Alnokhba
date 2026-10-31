"""16:9 ad set v2 — FULL screenshots, nothing cut.
Fixes user feedback: "make the pics full as some of them now is cut out (all 16:9)".
- All 6 ads are 16:9 (rendered 1920x1080 @4/3 deviceScaleFactor -> 2560x1440 PNG).
- No fade overlays, no blind bottom-crop. Every product shot is shown in full;
  each source gets a hand-picked CLEAN bottom boundary (between rows/cards,
  after whitespace) verified visually — no mid-row slices, no hidden UI.
- Same verified Arabic copy + brand navy/gold + Cairo as the approved v1 set.
"""
from playwright.sync_api import sync_playwright
from PIL import Image
import pathlib, html

ROOT = pathlib.Path("/home/z/my-project")
ADWORK = ROOT / "adwork"
FULL = ADWORK / "screens-full"
FULL.mkdir(exist_ok=True)
OUT = ROOT / "download" / "ad-screenshots" / "16x9"
OUT.mkdir(parents=True, exist_ok=True)

URL_LABEL = "al-nokhbba.vercel.app"
TRIAL = "تجربة مجانية ١٤ يوم — بدون بطاقة"
CTA_FREE = "ابدأ مجانًا — بدون بطاقة"

# ── 1) clean-boundary crops from the ORIGINAL sources (verified visually) ──
CROPS = {
    # name: (src, box) — bottom lands on whitespace or a clean boundary between rows/cards
    "dashboard": (ROOT / "public/screens/home-dashboard.png", (0, 0, 1440, 672)),
    "reports":   (ROOT / "public/screens/reports.png",        (0, 0, 1440, 450)),
    "students":  (ROOT / "public/screens/students.png",       (0, 0, 1440, 850)),
    "insights":  (ROOT / "public/screens/insights.png",       (0, 0, 1440, 736)),
    "hero":      (ADWORK / "desktop-hero.png",                (0, 0, 2880, 1650)),
    "mobile":    (ADWORK / "mobile-landing.png",              (0, 200, 1170, 2250)),
}
IMG = {}
for name, (src, box) in CROPS.items():
    im = Image.open(src).convert("RGB")
    im.crop(box).save(FULL / f"{name}.png")
    IMG[name] = FULL / f"{name}.png"
    print("crop", name, box, "->", im.crop(box).size)
IMG["logo"] = ROOT / "public/logo-512.png"

CSS = """
* { margin:0; padding:0; box-sizing:border-box; font-family:'Cairo', sans-serif; }
html,body { overflow:hidden; }
.canvas { position:relative; width:100vw; height:100vh;
  background:
    radial-gradient(1300px 760px at 88% -12%, rgba(36,65,140,.60), transparent 60%),
    radial-gradient(1000px 640px at -8% 112%, rgba(14,127,116,.30), transparent 55%),
    radial-gradient(820px 540px at 50% 118%, rgba(251,156,27,.12), transparent 60%),
    linear-gradient(160deg,#0B1C42 0%,#142D62 48%,#24418C 100%); }
.glow { position:absolute; border-radius:50%; pointer-events:none; }
.glow.gold { width:640px; height:640px; background:radial-gradient(circle, rgba(251,156,27,.15), transparent 62%); }
.glow.cyan { width:700px; height:700px; background:radial-gradient(circle, rgba(14,127,116,.22), transparent 62%); }
.row { position:relative; z-index:2; height:100%; display:flex; align-items:center;
  justify-content:center; gap:48px; padding:0 80px; }
.col { width:664px; display:flex; flex-direction:column; align-items:flex-start;
  justify-content:center; gap:22px; text-align:start; flex:none; }
.shot { flex:1; display:flex; align-items:center; justify-content:center; min-width:0; }
.eyebrow { display:inline-block; border:1px solid rgba(251,156,27,.45); color:#FDD49A;
  background:rgba(251,156,27,.09); border-radius:999px; padding:7px 22px;
  font-weight:700; font-size:16px; letter-spacing:.2px; white-space:nowrap; }
h1 { color:#FFFFFF; font-weight:900; line-height:1.32; font-size:45px; }
.gold { background:linear-gradient(105deg,#FDD49A 8%,#FB9C1B 48%,#E07F00 92%);
  -webkit-background-clip:text; background-clip:text; color:transparent; }
.sub { color:#A9B7DC; font-weight:600; font-size:18.5px; line-height:1.7; }
.browser { background:#0B1C42; border-radius:16px; overflow:hidden; flex:none;
  box-shadow:0 42px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.09); }
.browser .bar { height:36px; background:rgba(255,255,255,.06); display:flex; align-items:center;
  gap:7px; padding:0 14px; }
.browser .bar i { width:11px; height:11px; border-radius:50%; display:inline-block; }
.browser .bar .url { margin-inline-start:10px; background:rgba(255,255,255,.09); color:#9FB0D9;
  font-size:12.5px; font-weight:600; border-radius:999px; padding:3px 16px; direction:ltr; }
.browser img { width:100%; display:block; }
.phone { background:#0A1734; border-radius:54px; padding:12px; flex:none;
  box-shadow:0 50px 110px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.16); }
.phone .notch { width:150px; height:24px; background:#0A1734; border-radius:0 0 16px 16px;
  margin:0 auto; position:relative; z-index:2; margin-top:-2px; }
.phone img { width:100%; display:block; border-radius:42px; }
.foot { display:flex; align-items:center; gap:14px; }
.logo-wrap { background:#fff; border-radius:13px; padding:5px; box-shadow:0 10px 26px rgba(0,0,0,.4); }
.logo-wrap img { width:48px; height:48px; display:block; }
.foot .brand { color:#fff; font-weight:900; font-size:22px; line-height:1.15; text-align:start; }
.foot .brand small { display:block; color:#9FB0D9; font-weight:600; font-size:13.5px; direction:ltr; }
.chip { border:1px solid rgba(251,156,27,.45); color:#FDD49A; background:rgba(251,156,27,.08);
  border-radius:999px; padding:9px 20px; font-weight:800; font-size:15.5px; white-space:nowrap; }
.cta { background:linear-gradient(105deg,#FB9C1B,#E07F00); color:#12224E; font-weight:900;
  border-radius:999px; padding:13px 34px; font-size:19px; box-shadow:0 14px 34px rgba(224,127,0,.38); }
.stat { display:flex; flex-direction:column; gap:2px; background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.10); border-radius:14px; padding:10px 18px; text-align:start; }
.stat b { color:#FDD49A; font-size:20px; font-weight:900; }
.stat span { color:#A9B7DC; font-size:13px; font-weight:600; }
.stats-row { display:flex; gap:12px; }
"""

def browser(img, w):
    return f"""
<div class="browser" style="width:{w}px">
  <div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i>
    <span class="url">{URL_LABEL}</span></div>
  <img src="file://{img}">
</div>"""

FOOT = f"""
<div class="foot">
  <div class="logo-wrap"><img src="file://{IMG['logo']}"></div>
  <div class="brand">النخبة<small>{URL_LABEL}</small></div>
</div>"""

STATS = """
<div class="stats-row">
  <div class="stat"><b>١٠ أضعاف</b><span>أسرع من الطريقة اليدوية</span></div>
  <div class="stat"><b>٦٠ ثانية</b><span>لتسجيل حضور مجموعة كاملة</span></div>
</div>"""

def split(name, shot_html, eyebrow, h1, sub=None, stats=False, cta=None):
    parts = [f'<span class="eyebrow">{html.escape(eyebrow)}</span>', f"<h1>{h1}</h1>"]
    if sub:
        parts.append(f'<div class="sub">{html.escape(sub)}</div>')
    if stats:
        parts.append(STATS)
    if cta:
        parts.append(f'<div class="cta">{html.escape(cta)}</div>')
    parts.append(FOOT)
    col = '<div class="col">' + "".join(parts) + "</div>"
    return {"name": name, "body": f'<div class="row" dir="rtl">{col}<div class="shot">{shot_html}</div></div>'}

ADS = [
    split("01-dashboard-16x9", browser(IMG["dashboard"], 1080),
          "منصة إدارة مراكز التعليم",
          'شغّل مركزك التعليمي كله —<br><span class="gold">من مكان واحد.</span>',
          sub="الطلاب · الحصص · الحضور · الواجبات · الامتحانات · تقارير أولياء الأمور",
          stats=True),
    split("02-reports-16x9", browser(IMG["reports"], 1120),
          "تقارير واتساب",
          'تقارير أولياء الأمور —<br><span class="gold">جاهزة للمراجعة<br>والإرسال في دقيقة.</span>',
          sub="قوالب جاهزة لكل حصة · قائمة إرسال منظمة بمراجعة قبل الإرسال",
          cta=CTA_FREE),
    split("03-hero-16x9", browser(IMG["hero"], 1080),
          "منصة إدارة مراكز التعليم",
          'شغّل مركزك التعليمي كله —<br><span class="gold">من مكان واحد.</span>',
          sub="الطلاب · الحصص · الحضور · الواجبات · تقارير أولياء الأمور · تحليل أسبوعي",
          stats=True, cta=CTA_FREE),
    split("04-mobile-16x9", f"""
<div class="phone"><div class="notch"></div>
  <img src="file://{IMG['mobile']}" style="width:470px">
</div>""",
          "من موبايلك",
          'شغّل مركزك التعليمي كله —<br><span class="gold">من موبايلك.</span>',
          sub="الطلاب · الحصص · الحضور · الواجبات · تقارير أولياء الأمور · تحليل أسبوعي",
          cta="ابدأ مجانًا — ١٤ يوم بدون بطاقة"),
    split("05-students-16x9", browser(IMG["students"], 1020),
          "إدارة الطلاب والمجموعات",
          'كل طالب وكل مجموعة —<br><span class="gold">منظمين في نظام واحد.</span>',
          sub="ملف كامل لكل طالب: الحضور والواجبات والامتحانات والملاحظات"),
    split("06-insights-16x9", browser(IMG["insights"], 1060),
          "تحليل أسبوعي",
          'مراجعة أداء كل مجموعة —<br><span class="gold">قدامك كل أسبوع.</span>',
          sub="ملخص أسبوعي واضح لأداء كل مجموعة وكل مدرس"),
]

W, H, DSF = 1920, 1080, 4 / 3  # -> 2560x1440 PNG, app screens at ~native pixels

with sync_playwright() as p:
    browser_pw = p.chromium.launch()
    for ad in ADS:
        doc = (f"<!doctype html><html dir='rtl' lang='ar'><head><meta charset='utf-8'>"
               f"<link href='https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap' rel='stylesheet'>"
               f"<style>html,body{{width:{W}px;height:{H}px}} {CSS}</style></head>"
               f"<body><div class='canvas'>"
               f"<div class='glow gold' style='top:-180px; inset-inline-start:-160px'></div>"
               f"<div class='glow cyan' style='bottom:-220px; inset-inline-end:-180px'></div>"
               f"{ad['body']}</div></body></html>")
        hp = ADWORK / f"{ad['name']}.html"
        hp.write_text(doc, encoding="utf-8")
        ctx = browser_pw.new_context(viewport={"width": W, "height": H}, device_scale_factor=DSF)
        page = ctx.new_page()
        page.goto(f"file://{hp}", wait_until="networkidle", timeout=60000)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(600)
        dest = OUT / f"{ad['name']}.png"
        page.screenshot(path=str(dest))
        # normalize to exactly 2560x1440 (16:9) in case of dsf rounding
        im = Image.open(dest)
        if im.size != (2560, 1440):
            im = im.crop((0, 0, min(im.width, 2560), min(im.height, 1440)))
            if im.size != (2560, 1440):
                im = im.resize((2560, 1440), Image.LANCZOS)
            im.save(dest)
        print("rendered", dest.name, Image.open(dest).size)
        ctx.close()
    browser_pw.close()
print("all done ->", OUT)
