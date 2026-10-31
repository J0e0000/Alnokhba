"""Compose clean ad-ready PNGs from real Alnokhba screenshots.
Renders HTML templates with Playwright (Cairo font, brand navy/gold) at 2x."""
from playwright.sync_api import sync_playwright
import pathlib, html

ROOT = pathlib.Path("/home/z/my-project")
ADWORK = ROOT / "adwork"
OUT = ROOT / "download" / "ad-screenshots"
OUT.mkdir(parents=True, exist_ok=True)
CROPPED = ADWORK / "screens-cropped"
CROPPED.mkdir(exist_ok=True)

# ── auto-crop trailing near-white rows from bottom of desktop product shots ──
from PIL import Image as PILImage
def crop_bottom(src, dst, keep_min=560, pad=28, thresh=246, x_end=None):
    im = PILImage.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    last = keep_min - pad - 1  # if no content below keep_min, crop exactly at keep_min
    xe = x_end or w
    for y in range(h - 1, keep_min - 1, -1):
        # scan content area only — skip the app's dark sidebar (x >= 1100)
        dark = any(sum(px[x, y]) < thresh * 3 for x in range(0, xe, 6))
        if dark:
            last = y
            break
    new_h = min(h, max(keep_min, last + 1 + pad))
    im.crop((0, 0, w, new_h)).save(dst)
    return new_h

for _n, _km in (("home-dashboard", 560), ("students", 560), ("insights", 560), ("reports", 640)):
    _nh = crop_bottom(ROOT / f"public/screens/{_n}.png", CROPPED / f"{_n}.png", keep_min=_km, x_end=1050)
    print("cropped", _n, "-> height", _nh)

# story ad: drop the marketing nav (wraps at 390px) — keep from hero down
_m = PILImage.open(ADWORK / "mobile-landing.png").convert("RGB")
_m.crop((0, 200, _m.width, _m.height)).save(ADWORK / "mobile-landing-hero.png")
print("mobile hero crop ->", _m.height - 200)

IMG = {
    "dashboard": CROPPED / "home-dashboard.png",
    "students": CROPPED / "students.png",
    "insights": CROPPED / "insights.png",
    "reports": CROPPED / "reports.png",
    "desktop-hero": ADWORK / "desktop-hero.png",
    "mobile-landing": ADWORK / "mobile-landing-hero.png",
    "logo": ROOT / "public/logo-512.png",
}
URL_LABEL = "al-nokhbba.vercel.app"
TRIAL = "تجربة مجانية ١٤ يوم — بدون بطاقة"

CSS = """
* { margin:0; padding:0; box-sizing:border-box; font-family:'Cairo', sans-serif; }
html,body { overflow:hidden; }
.canvas { position:relative; width:100vw; height:100vh; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center;
  background:
    radial-gradient(1100px 640px at 88% -12%, rgba(36,65,140,.60), transparent 60%),
    radial-gradient(880px 560px at -8% 112%, rgba(14,127,116,.30), transparent 55%),
    radial-gradient(700px 480px at 50% 118%, rgba(251,156,27,.12), transparent 60%),
    linear-gradient(160deg,#0B1C42 0%,#142D62 48%,#24418C 100%); }
.glow { position:absolute; border-radius:50%; pointer-events:none; }
.glow.gold { width:560px; height:560px; background:radial-gradient(circle, rgba(251,156,27,.15), transparent 62%); }
.glow.cyan { width:620px; height:620px; background:radial-gradient(circle, rgba(14,127,116,.22), transparent 62%); }
.eyebrow { display:inline-block; border:1px solid rgba(251,156,27,.45); color:#FDD49A;
  background:rgba(251,156,27,.09); border-radius:999px; padding:7px 22px;
  font-weight:700; font-size:17px; letter-spacing:.2px; }
h1 { color:#FFFFFF; font-weight:900; line-height:1.3; }
.gold { background:linear-gradient(105deg,#FDD49A 8%,#FB9C1B 48%,#E07F00 92%);
  -webkit-background-clip:text; background-clip:text; color:transparent; }
.sub { color:#A9B7DC; font-weight:600; }
.browser { background:#0B1C42; border-radius:16px; overflow:hidden;
  box-shadow:0 42px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.09); }
.browser .bar { height:34px; background:rgba(255,255,255,.06); display:flex; align-items:center; gap:7px; padding:0 14px; }
.browser .bar i { width:11px; height:11px; border-radius:50%; display:inline-block; }
.browser .bar .url { margin-inline-start:10px; background:rgba(255,255,255,.09); color:#9FB0D9;
  font-size:12px; font-weight:600; border-radius:999px; padding:3px 16px; direction:ltr; }
.browser .screen { position:relative; }
.browser .screen img { width:100%; display:block; }
.browser .screen .fade { position:absolute; left:0; right:0; bottom:0; height:13%; pointer-events:none; }
.fade-light { background:linear-gradient(180deg, rgba(248,250,252,0), #F8FAFC 94%); }
.fade-dark { background:linear-gradient(180deg, rgba(10,23,52,0), #0A1734 94%); }
.phone { background:#0A1734; border-radius:54px; padding:12px;
  box-shadow:0 50px 110px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.16); }
.phone .notch { width:150px; height:24px; background:#0A1734; border-radius:0 0 16px 16px;
  margin:0 auto; position:relative; z-index:2; margin-top:-2px; }
.phone img { width:100%; display:block; border-radius:42px; }
.foot { display:flex; align-items:center; gap:14px; }
.logo-wrap { background:#fff; border-radius:13px; padding:5px; box-shadow:0 10px 26px rgba(0,0,0,.4); }
.logo-wrap img { width:46px; height:46px; display:block; }
.foot .brand { color:#fff; font-weight:900; font-size:22px; line-height:1.15; text-align:start; }
.foot .brand small { display:block; color:#9FB0D9; font-weight:600; font-size:13.5px; direction:ltr; }
.chip { border:1px solid rgba(251,156,27,.45); color:#FDD49A; background:rgba(251,156,27,.08);
  border-radius:999px; padding:9px 20px; font-weight:800; font-size:16px; }
.cta { background:linear-gradient(105deg,#FB9C1B,#E07F00); color:#12224E; font-weight:900;
  border-radius:999px; padding:14px 38px; font-size:21px; box-shadow:0 14px 34px rgba(224,127,0,.38); }
.stat { display:flex; flex-direction:column; gap:2px; background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.10); border-radius:14px; padding:10px 18px; text-align:start; }
.stat b { color:#FDD49A; font-size:19px; font-weight:900; }
.stat span { color:#A9B7DC; font-size:13px; font-weight:600; }
"""

BROWSER = lambda img, w, fade="fade-light": f"""
<div class="browser" style="width:{w}px">
  <div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i>
    <span class="url">{URL_LABEL}</span></div>
  <div class="screen"><img src="file://{img}"><i class="fade {fade}"></i></div>
</div>"""

FOOT = lambda chip=True: f"""
<div class="foot">
  <div class="logo-wrap"><img src="file://{IMG['logo']}"></div>
  <div class="brand">النخبة<small>{URL_LABEL}</small></div>
  {'<div class="chip" style="margin-inline-start:auto">' + TRIAL + "</div>" if chip else ""}
</div>"""

def square(name, eyebrow, h1, sub, img):
    body = f"""
    <div style="position:relative; z-index:2; width:960px; height:100%; display:flex; flex-direction:column;
                align-items:center; justify-content:center; gap:26px; padding:52px 0;">
      <span class="eyebrow">{html.escape(eyebrow)}</span>
      <h1 style="font-size:50px; max-width:920px;">{h1}</h1>
      <div class="sub" style="font-size:19px;">{html.escape(sub)}</div>
      {BROWSER(IMG[img], 880)}
      {FOOT()}
    </div>"""
    return {"name": name, "w": 1080, "h": 1080, "body": body}

AD_SQUARE_DASH = square(
    "01-square-dashboard-1080", "منصة إدارة مراكز التعليم",
    'شغّل مركزك التعليمي كله —<br><span class="gold">من مكان واحد.</span>',
    "الطلاب · الحصص · الحضور · الواجبات · الامتحانات · تقارير أولياء الأمور", "dashboard")

AD_SQUARE_STUDENTS = square(
    "05-square-students-1080", "إدارة الطلاب والمجموعات",
    'كل طالب وكل مجموعة —<br><span class="gold">منظمين في نظام واحد.</span>',
    "ملف كامل لكل طالب: الحضور والواجبات والامتحانات والملاحظات", "students")

AD_SQUARE_INSIGHTS = square(
    "06-square-insights-1080", "تحليل أسبوعي",
    'مراجعة أداء كل مجموعة —<br><span class="gold">قدامك كل أسبوع.</span>',
    "ملخص أسبوعي واضح لأداء كل مجموعة وكل مدرس", "insights")

AD_PORTRAIT_REPORTS = {
    "name": "02-portrait-reports-1080x1350", "w": 1080, "h": 1350,
    "body": f"""
    <div style="position:relative; z-index:2; width:960px; height:100%; display:flex; flex-direction:column;
                align-items:center; justify-content:center; gap:30px; padding:64px 0;">
      <span class="eyebrow">تقارير واتساب</span>
      <h1 style="font-size:48px; max-width:880px;">تقارير أولياء الأمور —<br><span class="gold">جاهزة للمراجعة والإرسال في دقيقة.</span></h1>
      <div class="sub" style="font-size:19px;">قوالب جاهزة لكل حصة · قائمة إرسال منظمة بمراجعة قبل الإرسال</div>
      {BROWSER(IMG["reports"], 940)}
      <div class="cta">ابدأ مجانًا — بدون بطاقة</div>
      {FOOT()}
    </div>"""}

AD_WIDE_HERO = {
    "name": "03-wide-hero-1200x628", "w": 1200, "h": 628,
    "body": f"""
    <div dir="rtl" style="position:relative; z-index:2; width:1120px; height:100%; display:flex;
                align-items:center; justify-content:space-between; gap:44px;">
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:18px; width:520px; text-align:start;">
        <span class="eyebrow">منصة إدارة مراكز التعليم</span>
        <h1 style="font-size:37px;">شغّل مركزك التعليمي كله — <span class="gold">من مكان واحد.</span></h1>
        <div class="sub" style="font-size:16.5px;">الطلاب · الحصص · الحضور · الواجبات · تقارير أولياء الأمور · تحليل أسبوعي</div>
        <div style="display:flex; gap:12px;">
          <div class="stat"><b>١٠ أضعاف</b><span>أسرع من الطريقة اليدوية</span></div>
          <div class="stat"><b>٦٠ ثانية</b><span>لتسجيل حضور مجموعة كاملة</span></div>
        </div>
        <div style="display:flex; align-items:center; gap:16px;">
          <div class="cta" style="font-size:18px; padding:11px 28px;">ابدأ مجانًا — بدون بطاقة</div>
          <span style="color:#9FB0D9; font-size:14px; direction:ltr; font-weight:700;">{URL_LABEL}</span>
        </div>
      </div>
      {BROWSER(IMG["desktop-hero"], 560, fade="fade-dark")}
    </div>"""}

AD_STORY_MOBILE = {
    "name": "04-story-mobile-1080x1920", "w": 1080, "h": 1920,
    "body": f"""
    <div style="position:relative; z-index:2; width:960px; height:100%; display:flex; flex-direction:column;
                align-items:center; justify-content:center; gap:34px; padding:90px 0;">
      <span class="eyebrow" style="font-size:20px;">من موبايلك</span>
      <h1 style="font-size:60px; max-width:900px;">شغّل مركزك التعليمي كله —<br><span class="gold">من موبايلك.</span></h1>
      <div class="phone">
        <div class="notch"></div>
        <img src="file://{IMG['mobile-landing']}" style="width:520px">
      </div>
      <div class="cta" style="font-size:24px;">ابدأ مجانًا — ١٤ يوم بدون بطاقة</div>
      {FOOT(chip=False)}
    </div>"""}

ADS = [AD_SQUARE_DASH, AD_PORTRAIT_REPORTS, AD_WIDE_HERO, AD_STORY_MOBILE,
       AD_SQUARE_STUDENTS, AD_SQUARE_INSIGHTS]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for ad in ADS:
        w, h = ad["w"], ad["h"]
        doc = (f"<!doctype html><html dir='rtl' lang='ar'><head><meta charset='utf-8'>"
               f"<link href='https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap' rel='stylesheet'>"
               f"<style>html,body{{width:{w}px;height:{h}px}} {CSS}</style></head>"
               f"<body><div class='canvas'>"
               f"<div class='glow gold' style='top:-160px; inset-inline-start:-140px'></div>"
               f"<div class='glow cyan' style='bottom:-200px; inset-inline-end:-160px'></div>"
               f"{ad['body']}</div></body></html>")
        hp = ADWORK / f"{ad['name']}.html"
        hp.write_text(doc, encoding="utf-8")
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(f"file://{hp}", wait_until="networkidle", timeout=60000)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(600)
        dest = OUT / f"{ad['name']}.png"
        page.screenshot(path=str(dest))
        print("rendered", dest.name)
        ctx.close()
    browser.close()
print("all done")
