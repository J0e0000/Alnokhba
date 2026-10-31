#!/usr/bin/env python3
"""Unified pricing copy update (500 EGP flat) — line-targeted replacements
anchored on unique ASCII-safe substrings, so RTL diacritics can't bite."""
import io, sys

BASE = '/home/z/my-project/frontend/src/'
FAILS = []

def replace_line(path, anchor, new_line, must=True, drop=False):
    """Replace the ENTIRE line containing `anchor` (first match) with new_line."""
    p = BASE + path
    lines = io.open(p, encoding='utf-8').read().split('\n')
    for i, ln in enumerate(lines):
        if anchor in ln:
            lines[i] = '' if drop else new_line
            io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
            print(f'OK   {path} :: line {i+1}')
            return True
    if must:
        FAILS.append(f'{path} :: anchor not found: {anchor}')
    return False

# ── LandingPage.jsx ──────────────────────────────────────────────────────────
replace_line('pages/LandingPage.jsx', 'Starter حتى',
    "  ['أقدر أدير كام طالب؟', 'مفيش حد — ٥٠٠ جنيه/شهر ثابتة لأي عدد من الطلاب النشطين، من أول طالب لحد آلاف، وكل المميزات مفتوحة من أول يوم. وإدارة الفروع المتعددة قيد التطوير (قريبًا).'],")
replace_line('pages/LandingPage.jsx', '٣٩٩ ج/شهر',
    "  ['الأسعار إزاي؟', 'سعر واحد موحّد: ٥٠٠ جنيه/شهر لأي عدد طلاب وبكل المميزات — والتفعيل بيتأكد معك شخصيًا على واتساب. مفيش دفع أونلاين ولا خصم صامت.'],")
replace_line('pages/LandingPage.jsx', 'بعدها تختار الباقة',
    '          <SectionHead center eyebrow="الباقات" title="سعر واحد واضح — ابدأ مجانًا وشوف الفايدة بنفسك." sub={`تجربة مجانية ${fmtAr(TRIAL.days)} يوم بكل المميزات ومن غير بطاقة. بعدها اشتراك واحد: ٥٠٠ جنيه/شهر لأي عدد طلاب — والتفعيل بيتم على واتساب.`} />')
replace_line('pages/LandingPage.jsx', 'md:grid-cols-2 xl:grid-cols-4',
    '          <div className="mx-auto mt-12 grid max-w-xl gap-5">')
replace_line('pages/LandingPage.jsx', 'الأكثر اختيارًا', '', drop=True)

# ── Signup.jsx ────────────────────────────────────────────────────────────────
replace_line('pages/Signup.jsx', '٣٩٩ جنيه/شهر',
    '                  ولو كملت اشتراك واحد ٥٠٠ جنيه/شهر (أي عدد طلاب) وبيتفعل على واتساب. مفيش تجديد تلقائي.')

# ── CorePages.jsx (contact page) ─────────────────────────────────────────────
replace_line('marketing/pages/CorePages.jsx', 'تبدأ من ٣٩٩',
    '          بعد التجربة: اشتراك واحد ٥٠٠ جنيه/شهر لأي عدد من الطلاب وتتفق على التفاصيل على{\' \'}')

# ── articles.js ──────────────────────────────────────────────────────────────
replace_line('marketing/articles.js', 'لباقة Starter',
    "      ['p', 'أسعار أنظمة إدارة المراكز غالبًا بتتبع الحجم وعدد الفروع — لكن إحنا اخترنا البساطة: اشتراك موحّد ٥٠٠ جنيه/شهر لأي عدد من الطلاب النشطين وبكل المميزات. احذر من عقد طويل ببلاش مبرر، ومن «تجديد تلقائي» صامت — أفضل نماذج الاشتراك في السوق بتبقى تجربة مجانية بدون بطاقة، وبعدها اشتراك بتفعيل يدوي واضح. واسأل دايمًا: هل السعر هيزيد مع نمو عدد طلابك؟ عندنا الإجابة: لأ.'],")

# ── SubscriptionGate.jsx ─────────────────────────────────────────────────────
replace_line('pages/SubscriptionGate.jsx', 'واختار الباقة المناسبة',
    '          كلمنا على واتساب وفعّل اشتراكك — ٥٠٠ جنيه/شهر ثابتة لأي عدد من الطلاب. مفيش تجديد تلقائي ولا خصم صامت،')

print()
if FAILS:
    print('FAILED ANCHORS:'); [print(' -', f) for f in FAILS]; sys.exit(1)
print('ALL REPLACEMENTS OK')
