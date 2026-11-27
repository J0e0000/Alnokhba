#!/usr/bin/env python3
"""Viewport captures mid-scroll so scroll-reveal animations have fired."""
from playwright.sync_api import sync_playwright

OUT = '/home/z/my-project/download/screenshots'
BASE = 'http://localhost:5173'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()

    # landing: scroll through, then capture hero + a mid section settled
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    for y in range(0, 6000, 800):
        page.evaluate(f'window.scrollTo(0, {y})')
        page.wait_for_timeout(250)
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/landing-hero-settled.png')
    page.evaluate('window.scrollTo(0, 2200)')
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/landing-mid-settled.png')

    # pricing: settle then capture top
    page.goto(f'{BASE}/pricing')
    page.wait_for_load_state('networkidle')
    page.evaluate('window.scrollTo(0, 1200)')
    page.wait_for_timeout(400)
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/pricing-hero-settled.png')
    browser.close()
print('settled captures done')
