"""Capture fresh high-res screenshots of the live Alnokhba site for ad composition."""
from playwright.sync_api import sync_playwright
import pathlib

OUT = pathlib.Path("/home/z/my-project/adwork")
OUT.mkdir(exist_ok=True)
SITE = "https://al-nokhbba.vercel.app"

jobs = [
    # (name, width, height, device_scale_factor, full_page)
    ("mobile-landing", 390, 844, 3, False),
    ("desktop-hero", 1440, 900, 2, False),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, w, h, dsf, full in jobs:
        ctx = browser.new_context(viewport={"width": w, "height": h},
                                  device_scale_factor=dsf)
        page = ctx.new_page()
        page.goto(SITE, wait_until="networkidle", timeout=60000)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(3500)  # let hero animations settle
        page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
        print("captured", name, "->", OUT / f"{name}.png")
        ctx.close()
    browser.close()
print("done")
