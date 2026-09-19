#!/bin/bash
# UX restructure regression v2 — proper expression IIFEs so evals return values
set -u
cd /home/z/my-project
mkdir -p /home/z/my-project/download/ux-test

echo "── starting vite ──"
pkill -f vite 2>/dev/null; sleep 1
npm run start > /tmp/devserver.log 2>&1 &
VITE_PID=$!
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 3 || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "vite ready ($code), pid $VITE_PID"

B="agent-browser"
$B set viewport 1280 900
$B open "http://localhost:3000/?auth=login" 2>&1 | tail -1
$B wait --load networkidle
$B storage local clear
$B reload
$B wait --load networkidle

echo "── login ──"
$B eval "(() => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const em = document.querySelector('input[type=email]'); const pw = document.querySelector('input[type=password]'); setter.call(em, 'demo@nokhba.test'); em.dispatchEvent(new Event('input', {bubbles:true})); setter.call(pw, 'demo123456'); pw.dispatchEvent(new Event('input', {bubbles:true})); return 'filled' })()"
$B eval "document.querySelector('form button[type=\"submit\"]').click(); 'submitted'"
sleep 4
$B wait --load networkidle 2>/dev/null
echo "url now: $($B get url)"
$B screenshot /home/z/my-project/download/ux-test/01-home-desktop.png

echo "── sidebar must have NO logout ──"
$B eval "(() => { const sb = document.querySelector('.nk-sidebar'); return sb ? ('sidebar logout: ' + /خروج|Sign out/.test(sb.innerText)) : 'no-sidebar' })()"

echo "── open next session (gold card) ──"
$B eval "(() => { const c = document.querySelector('.nk-session-card--next'); return c ? (c.click(), 'opened: ' + c.querySelector('b').innerText) : 'NO NEXT CARD' })()"
sleep 3
$B screenshot /home/z/my-project/download/ux-test/02-session-attendance-focus.png
$B eval "(() => { const card = document.querySelector('.nk-focus-card'); const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ focusCard: card ? card.innerText.slice(0, 150) : null, barPrimary: bar ? Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText) : null, barSecondary: bar ? Array.from(bar.querySelectorAll('.nk-wf-ghost')).map(b => b.innerText) : null, meta: bar ? ((bar.querySelector('.nk-workflow-bar__meta') || {}).innerText || '') : '' }) })()"

echo "── mark present → next activates ──"
$B eval "(() => { document.querySelector('.nk-workflow-bar .nk-mark-present').click(); return 'marked-present' })()"
sleep 1.2
$B screenshot /home/z/my-project/download/ux-test/03-after-present-mark.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ state: document.querySelector('.nk-focus-state').innerText, primary: Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => ({t: b.innerText, disabled: b.disabled})), meta: (bar.querySelector('.nk-workflow-bar__meta') || {}).innerText || '' }) })()"

echo "── click next → student 2 → mark absent ──"
$B eval "(() => { document.querySelector('.nk-workflow-bar .btn-gold').click(); return 'next' })()"
sleep 0.8
$B eval "(() => { document.querySelector('.nk-workflow-bar .nk-mark-absent').click(); return 'marked-absent' })()"
sleep 1.2
$B screenshot /home/z/my-project/download/ux-test/04-student2-absent.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ name: document.querySelector('.nk-focus-name').innerText, state: document.querySelector('.nk-focus-state').innerText, primary: Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText), meta: (bar.querySelector('.nk-workflow-bar__meta') || {}).innerText || '' }) })()"

echo "── switch to list mode, bulk all-present ──"
$B eval "(() => { const b = Array.from(document.querySelectorAll('.nk-wf-ghost')).find(x => /القائمة|List/.test(x.innerText)); return b ? (b.click(), 'list') : 'NO LIST BTN' })()"
sleep 0.8
$B screenshot /home/z/my-project/download/ux-test/05-attendance-list.png
$B eval "(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => /الكل حاضر|All present/.test(b.innerText)); return btn ? (btn.click(), 'bulk-clicked') : 'no-bulk-btn' })()"
sleep 1.5
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ pills: Array.from(document.querySelectorAll('.nk-pill-pending, .nk-pill-live, .nk-pill-danger')).slice(0,4).map(p => p.innerText), barPrimary: bar ? Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText) : null }) })()"

echo "── continue → interaction ──"
$B eval "(() => { document.querySelector('.nk-workflow-bar .btn-gold').click(); return 'to-interaction' })()"
sleep 1.2
$B screenshot /home/z/my-project/download/ux-test/06-interaction.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ heading: document.querySelector('[role=tabpanel] h3').innerText, primary: Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText) }) })()"

echo "── next → exams → next → review ──"
$B eval "(() => { document.querySelector('.nk-workflow-bar .btn-gold').click(); return 'to-exams' })()"
sleep 1.2
$B eval "(() => { document.querySelector('.nk-workflow-bar .btn-gold').click(); return 'to-review' })()"
sleep 1.2
$B screenshot /home/z/my-project/download/ux-test/07-review.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ heading: document.querySelector('[role=tabpanel] h3').innerText, primary: Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText), meta: (bar.querySelector('.nk-workflow-bar__meta')||{}).innerText || '' }) })()"

echo "── next → report → finish session ──"
$B eval "(() => { document.querySelector('.nk-workflow-bar .btn-gold').click(); return 'to-report' })()"
sleep 1.2
$B screenshot /home/z/my-project/download/ux-test/08-report.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ heading: document.querySelector('[role=tabpanel] h3').innerText, primary: Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText) }) })()"
$B eval "(() => { const b = Array.from(document.querySelectorAll('.nk-workflow-bar__primary button')).find(x => /إنهاء/.test(x.innerText)); return b ? (b.click(), 'finish-clicked') : 'NO FINISH BTN' })()"
sleep 1
$B screenshot /home/z/my-project/download/ux-test/09-finish-confirm.png
$B eval "(() => { const dlg = document.querySelector('[role=dialog]'); if (!dlg) return 'no-dialog'; const okBtn = Array.from(dlg.querySelectorAll('button')).find(b => /إنهاء/.test(b.innerText)); return okBtn ? (okBtn.click(), 'confirmed') : 'dialog-no-confirm: ' + dlg.innerText.slice(0,80) })()"
sleep 3
$B screenshot /home/z/my-project/download/ux-test/10-after-finish.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); return JSON.stringify({ statusPill: (document.querySelector('.nk-ws-head .nk-pill')||{}).innerText || '', primary: bar ? Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText) : null }) })()"

echo "── back home; account menu + logout confirm ──"
$B eval "(() => { const b = Array.from(document.querySelectorAll('.nk-workflow-bar__primary button')).find(x => /الرئيسية|Home/.test(x.innerText)); return b ? (b.click(), 'home') : 'no-home-btn' })()"
sleep 1.5
$B eval "(() => { const b = document.querySelector('.nk-account-anchor button'); return b ? (b.click(), 'menu-open') : 'NO AVATAR' })()"
sleep 0.8
$B screenshot /home/z/my-project/download/ux-test/11-account-menu.png
$B eval "(() => { const menu = document.querySelector('.nk-account-menu'); return menu ? menu.innerText : 'NO MENU' })()"
$B eval "(() => { const b = Array.from(document.querySelectorAll('.nk-account-menu__item')).find(x => /خروج|Sign out/.test(x.innerText)); return b ? (b.click(), 'logout-clicked') : 'no-logout-item' })()"
sleep 1
$B eval "(() => { const dlg = document.querySelector('[role=dialog]'); return dlg ? 'CONFIRM SHOWN: ' + dlg.innerText.slice(0, 110) : 'NO CONFIRM DIALOG' })()"
$B screenshot /home/z/my-project/download/ux-test/12-logout-confirm.png
$B eval "(() => { const dlg = document.querySelector('[role=dialog]'); if (!dlg) return 'no-cancel'; const cancel = Array.from(dlg.querySelectorAll('button')).find(b => /إلغاء|Cancel/.test(b.innerText)); return cancel ? (cancel.click(), 'cancelled-stay-logged-in') : 'no-cancel-btn' })()"
sleep 0.8

echo "── mobile 390px ──"
$B set viewport 390 844
sleep 1.5
$B screenshot /home/z/my-project/download/ux-test/13-home-mobile.png
$B eval "(() => { const nav = document.querySelector('.nk-bottom-nav'); return JSON.stringify({ navItems: nav ? Array.from(nav.querySelectorAll('button')).map(b => b.innerText.replace(/\n/g, ' ')) : 'NO NAV', hasLogout: nav ? /خروج|Exit/.test(nav.innerText) : null }) })()"
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); const homeBtn = bar ? Array.from(bar.querySelectorAll('button')).find(b => /الرئيسية|Home/.test(b.innerText)) : null; if (homeBtn) { homeBtn.click(); return 'back-home-first' } const nav = Array.from(document.querySelectorAll('.nk-bottom-nav button')).find(b => /نظرة عامة|Overview/.test(b.innerText)); return nav ? (nav.click(), 'nav-home') : 'no-home-path' })()"
sleep 1.5
$B eval "(() => { const c = document.querySelector('.nk-session-card--next') || document.querySelector('.nk-session-card'); return c ? (c.click(), 'open-session-mobile: ' + (c.querySelector('b') || {}).innerText) : 'NO SESSION CARD' })()"
sleep 2.5
$B screenshot /home/z/my-project/download/ux-test/14-attendance-mobile.png
$B eval "(() => { const bar = document.querySelector('.nk-workflow-bar'); const nav = document.querySelector('.nk-bottom-nav'); const barRect = bar ? bar.getBoundingClientRect() : null; const navRect = nav ? nav.getBoundingClientRect() : null; return JSON.stringify({ barTop: barRect ? Math.round(barRect.top) : null, navTop: navRect ? Math.round(navRect.top) : null, barAboveNav: barRect && navRect ? barRect.bottom <= navRect.top + 2 : null, primary: bar ? Array.from(bar.querySelectorAll('.nk-workflow-bar__primary button')).map(b => b.innerText) : null }) })()"
$B screenshot /home/z/my-project/download/ux-test/15-attendance-mobile-scrolled.png --full 2>/dev/null || true

echo "── console errors ──"
$B errors 2>&1 | head -20

echo "── done ──"
echo "VITE_PID=$VITE_PID"
