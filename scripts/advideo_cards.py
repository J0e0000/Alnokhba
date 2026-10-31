#!/usr/bin/env python3
"""Render branded text cards (1920x1080 @2x = 3840x2160 PNG) + hand cursor PNG
for the Alnokhba ad video re-edit. Uses Cairo via Google Fonts (same as ads pipeline).
Output: /home/z/my-project/adwork/video/cards/
"""
import os
import base64
from playwright.sync_api import sync_playwright

OUT = "/home/z/my-project/adwork/video/cards"
os.makedirs(OUT, exist_ok=True)
LOGO = "/home/z/my-project/public/logo-512.png"
LOGO_URI = "data:image/png;base64," + base64.b64encode(open(LOGO, "rb").read()).decode()

BASE_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap');
* { margin:0; padding:0; box-sizing:border-box; font-family:'Cairo', sans-serif; }
html,body { width:1920px; height:1080px; overflow:hidden; }
.stage { width:1920px; height:1080px; display:flex; align-items:center; justify-content:center; }
.navy { background:
    radial-gradient(1200px 700px at 78% 18%, rgba(59,130,246,.20), transparent 60%),
    radial-gradient(900px 600px at 15% 85%, rgba(251,156,27,.10), transparent 55%),
    linear-gradient(135deg,#0B1C42 0%,#16305F 55%,#24418C 100%); }
.black { background:#000; }
.k { color:#fff; font-weight:900; font-size:150px; letter-spacing:.5px; text-align:center; line-height:1.25; }
.k .gold { color:#FB9C1B; }
"""

def page_html(inner, extra=""):
    return f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{BASE_CSS}{extra}</style></head><body>{inner}</body></html>"

CARDS = {}

# 1. Intro brand card
CARDS["card-intro"] = page_html("""
<div class="stage navy" style="flex-direction:column; gap:38px;">
  <img src='""" + LOGO_URI + """' style="width:210px;height:210px;border-radius:44px;box-shadow:0 30px 80px rgba(0,0,0,.45);" />
  <div style="color:#fff;font-weight:900;font-size:110px;line-height:1.1;letter-spacing:1px;">Alnokhba</div>
  <div style="direction:rtl;background:rgba(251,156,27,.16);border:1.5px solid rgba(251,156,27,.45);color:#FDD49A;font-weight:800;font-size:40px;padding:10px 46px;border-radius:999px;">منصة برامج مركز التعليم</div>
</div>""")

# 2-4. Kinetic cards (Arabic RTL, black)
CARDS["card-k1"] = page_html('<div class="stage black"><div class="k" dir="rtl">شغّل مركزك</div></div>')
CARDS["card-k2"] = page_html('<div class="stage black"><div class="k" dir="rtl">من <span class="gold">مكان واحد</span></div></div>')
CARDS["card-k3"] = page_html('<div class="stage black"><div class="k" dir="rtl"><span class="gold">٦٠ ثانية</span> لأول تقرير</div></div>')
# 5. CTA kinetic (their English closer)
CARDS["card-k4"] = page_html('<div class="stage black"><div class="k" style="letter-spacing:0;">Try it <span class="gold">today</span></div></div>')

# 6. Outro brand card
CARDS["card-outro"] = page_html("""
<div class="stage navy" style="flex-direction:column; gap:34px;">
  <img src='""" + LOGO_URI + """' style="width:170px;height:170px;border-radius:38px;box-shadow:0 26px 70px rgba(0,0,0,.45);" />
  <div style="color:#fff;font-weight:900;font-size:96px;line-height:1.15;" dir="rtl">ابدأ مجانًا — بدون بطاقة</div>
  <div style="direction:ltr;background:linear-gradient(105deg,#FB9C1B,#E07F00);color:#12224E;font-weight:900;font-size:44px;padding:16px 60px;border-radius:999px;box-shadow:0 18px 50px rgba(224,127,0,.40);">al-nokhbba.vercel.app</div>
  <div style="direction:rtl;color:#A9B7DC;font-weight:700;font-size:30px;">تجربة مجانية ١٤ يوم — بدون بطاقة</div>
</div>""")

# 7. Hand cursor (transparent, ~140px) — clean pointing-hand glyph
CURSOR_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 24 24">
<g transform="rotate(-12 12 12)">
<path d="M10.2 21.5c-.6 0-1.2-.3-1.6-.8l-3.4-4.4c-.3-.4-.2-.9.1-1.2.3-.3.9-.4 1.2-.1l1.9 1.4V6.2c0-.6.5-1.1 1.1-1.1s1.1.5 1.1 1.1v4.1h.5c.2-.5.7-.8 1.2-.8.5 0 1 .3 1.2.8h.4c.2-.4.6-.7 1.1-.7.5 0 .9.3 1.1.7h.5c.5-.6 1.4-.7 2-.1.3.3.5.7.5 1.1v5.2c0 2.8-2.2 5-5 5h-4z" fill="#FFFFFF" stroke="#1a1a1a" stroke-width="0.9"/>
<path d="M12.4 11.4v-1.2c0-.5.4-.9.9-.9s.9.4.9.9v1.2" fill="none" stroke="#1a1a1a" stroke-width="0.7"/>
<path d="M14.2 11.5v-1.6c0-.5.4-.9.9-.9s.9.4.9.9v1.6" fill="none" stroke="#1a1a1a" stroke-width="0.7"/>
<path d="M16 11.6v-1.9c0-.5.4-.9.9-.9s.9.4.9.9v2" fill="none" stroke="#1a1a1a" stroke-width="0.7"/>
</g></svg>"""

with open(f"{OUT}/cursor.svg", "w") as f:
    f.write(CURSOR_SVG)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
    page = ctx.new_page()
    for name, html in CARDS.items():
        page.set_content(html, wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{OUT}/{name}.png")
        print("rendered", name)
    # cursor: transparent page sized exactly to the sprite
    cur = ctx.new_page()
    cur.set_content('<html><body style="margin:0;background:transparent;width:180px;height:180px;overflow:hidden;">' + CURSOR_SVG.replace('width="280" height="280"', 'width="180" height="180"') + '</body></html>', wait_until="networkidle")
    cur.wait_for_timeout(400)
    cur.screenshot(path=f"{OUT}/cursor.png", omit_background=True, clip={"x":0, "y":0, "width":180, "height":180})
    print("rendered cursor")
    browser.close()
print("ALL DONE ->", OUT)
