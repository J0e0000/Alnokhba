#!/usr/bin/env python3
"""Operator note (d): real-browser self-test.

Logs into the dev app (demo backend — any email + 6+ char password), proves
the students page + card prints, captures the 4 card styles as REAL PDFs
(downloaded from the app's own print functions), and screenshots
students / landing / pricing on desktop and 390px mobile.

NO WhatsApp sends, NO End-class actions are touched anywhere in this script.
"""
import os
import sys

from playwright.sync_api import sync_playwright

OUT = '/home/z/my-project/download/screenshots'
os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:5173'

def fail(msg):
    print(f'FAIL: {msg}')
    sys.exit(1)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ── logged-in context ────────────────────────────────────────────────────
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    page.goto(f'{BASE}/?auth=login')
    page.wait_for_load_state('networkidle')
    page.fill('#login-email', 'youssef@demo.com')
    page.fill('#login-password', 'demo1234')
    page.press('#login-password', 'Enter')
    print('login OK')
    # one-time welcome popup overlays the shell — dismiss via its backdrop
    try:
        popup = page.locator('div[role="dialog"][aria-label="النخبة فيها جديد"]')
        popup.wait_for(timeout=8000)
        popup.click(position={'x': 12, 'y': 12})
        popup.wait_for(state='detached', timeout=8000)
        print('welcome popup dismissed')
    except Exception:
        print('no welcome popup')
    page.wait_for_selector('.nav-btn[data-tour="nav-students"]', timeout=30000)

    page.click('.nav-btn[data-tour="nav-students"]')
    page.wait_for_selector('h1:has-text("الطلاب")', timeout=20000)
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/students-desktop.png', full_page=True)
    print('students desktop screenshot saved')

    # ensure at least one student exists so card printing is enabled
    if page.locator('.nk-row').count() == 0:
        page.click("button:has-text('طالب جديد')")
        page.wait_for_selector('form input', timeout=10000)
        page.fill('form input >> nth=0', 'أحمد سمير')
        page.fill("input[placeholder='01xxxxxxxxx']", '01012345678')
        page.click("button:has-text('حفظ')")
        page.wait_for_timeout(1500)
        print('demo student added')
    rows = page.locator('.nk-row').count()
    print(f'student rows visible: {rows}')
    if rows == 0:
        fail('no student rows after add')

    # ── card styles: 4 real PDFs from the app's own print path ───────────────
    saved = 0
    for i in range(4):
        page.click("button:has-text('كروت QR')")
        page.wait_for_selector("button:has-text('طباعة كروت كل الطلاب')", timeout=15000)
        style_btn = page.locator('div.grid.grid-cols-4 button').nth(i)
        style_btn.click()
        page.wait_for_timeout(400)
        with page.expect_download(timeout=90000) as dl:
            page.click("button:has-text('طباعة كروت كل الطلاب')")
        path = f'{OUT}/cards-style-{chr(65 + i)}.pdf'
        dl.value.save_as(path)
        saved += 1
        print(f'style {chr(65 + i)} PDF saved ({os.path.getsize(path)} bytes)')
        page.wait_for_timeout(1200)  # modal auto-closes after success
    print(f'{saved}/4 style PDFs captured')
    if saved != 4:
        fail('missing style PDFs')

    # ── mobile 390px students page (same session) ────────────────────────────
    m = ctx.new_page()
    m.set_viewport_size({'width': 390, 'height': 844})
    m.goto(f'{BASE}/')
    m.wait_for_selector('nav.nk-bottom-nav [data-tour="nav-students"]', timeout=30000)
    m.click('nav.nk-bottom-nav [data-tour="nav-students"]')
    m.wait_for_selector('h1:has-text("الطلاب")', timeout=20000)
    m.wait_for_timeout(1200)
    overflow = m.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    print(f'mobile 390px horizontal overflow: {overflow}px {"(OK)" if overflow <= 0 else "(OVERFLOW!)"}')
    m.screenshot(path=f'{OUT}/students-mobile.png', full_page=True)
    print('students mobile screenshot saved')

    # ── logged-out marketing context ─────────────────────────────────────────
    ctx2 = browser.new_context(viewport={'width': 1280, 'height': 900})
    l = ctx2.new_page()
    l.goto(BASE)
    l.wait_for_load_state('networkidle')
    l.wait_for_timeout(1500)
    l.screenshot(path=f'{OUT}/landing-desktop.png', full_page=True)
    print('landing desktop screenshot saved')
    l.goto(f'{BASE}/pricing')
    l.wait_for_load_state('networkidle')
    l.wait_for_timeout(1500)
    l.screenshot(path=f'{OUT}/pricing-desktop.png', full_page=True)
    print('pricing desktop screenshot saved')

    lm = ctx2.new_page()
    lm.set_viewport_size({'width': 390, 'height': 844})
    lm.goto(BASE)
    lm.wait_for_load_state('networkidle')
    lm.wait_for_timeout(1500)
    ovf_l = lm.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    print(f'landing 390px horizontal overflow: {ovf_l}px {"(OK)" if ovf_l <= 0 else "(OVERFLOW!)"}')
    lm.screenshot(path=f'{OUT}/landing-mobile.png', full_page=True)
    print('landing mobile screenshot saved')

    browser.close()

print('ALL PROOFS CAPTURED')
