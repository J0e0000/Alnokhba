#!/usr/bin/env node
/* Final performance report PDF (Arabic-safe via Chromium print). */
import { chromium } from 'playwright'
import fs from 'node:fs'

const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, 'Noto Sans', sans-serif; color: #172033; margin: 0; font-size: 12.5px; line-height: 1.85; }
  h1 { font-size: 25px; margin: 0 0 4px; color: #0E2954; }
  h2 { font-size: 16.5px; margin: 26px 0 8px; color: #0E2954; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; }
  h3 { font-size: 13.5px; margin: 16px 0 6px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 11.8px; }
  th { background: #0E2954; color: #fff; padding: 7px 9px; text-align: right; font-weight: 700; }
  td { border: 1px solid #e2e8f0; padding: 6px 9px; }
  tr:nth-child(even) td { background: #f8fafc; }
  .good { color: #047857; font-weight: 800; }
  .same { color: #64748b; }
  .warn { color: #b45309; font-weight: 700; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin: 10px 0; }
  code { background: #eef2f7; border-radius: 5px; padding: 1px 6px; font-size: 11px; direction: ltr; display: inline-block; }
  ul { margin: 6px 0 12px; padding-inline-start: 22px; }
  li { margin-bottom: 5px; }
  .sev { display: inline-block; border-radius: 6px; padding: 0 8px; font-size: 10.5px; font-weight: 800; }
  .c { background: #fee2e2; color: #b91c1c; } .h { background: #ffedd5; color: #c2410c; } .m { background: #fef9c3; color: #a16207; } .l { background: #dcfce7; color: #15803d; }
</style></head><body>

<h1>تقرير الأداء النهائي — منصة النخبة</h1>
<div class="sub">Performance audit → bottlenecks → fixes → measurements · Deployed on production (vercel) ${new Date().toISOString().slice(0, 10)} · Harness: Playwright (desktop + mobile 4× CPU / Fast-3G 1.6Mbps·150ms) · Scripts kept in the repo under <code>scripts/</code>, raw data under <code>perf-results/</code></div>

<h2>1) أين كانت المشاكل؟ (Where the problems were)</h2>
<table>
<tr><th>#</th><th>الشدة</th><th>المشكلة</th><th>الدليل</th></tr>
<tr><td>C1</td><td><span class="sev c">CRITICAL</span></td><td>لا يوجد أي تقسيم للحِزمة (code-splitting): كل الصفحات + chart.js + html5-qrcode + jspdf + qrcode + html2canvas في حزمة واحدة تُحمَّل على كل صفحة حتى صفحة الدخول وبوابة أولياء الأمور</td><td>حزمة واحدة 2,027KB — كل صفحة كانت تنقل 387KB JS</td></tr>
<tr><td>C2</td><td><span class="sev c">CRITICAL</span></td><td>قيمة WorkspaceStore تُعاد بناؤها في كل render: أي تغيير واحد يعيد رسم الشجرة كلها، وكل حفظ = 3 رسومات كاملة</td><td><code>WorkspaceStore value</code> بدون useMemo</td></tr>
<tr><td>C3</td><td><span class="sev c">CRITICAL</span></td><td>loadAll() يُستخدم كـ"محدّث شامل": حدث realtime للامتحانات أو تعديل درجة واحدة = إعادة تحميل 6 جداول كاملة</td><td>students + كل exam_scores + 5,000 حضور + 500 حصة + 200 امتحان</td></tr>
<tr><td>H1</td><td><span class="sev h">HIGH</span></td><td>سلسلة الإقلاع 5-6 طلبات متسلسلة وتتكرر مرتين عند الإقلاع، وتُعاد كاملة مع كل تجديد توكن (كل ساعة) مع شاشة تحميل كاملة</td><td>onAuthStateChange بلا فلترة أحداث</td></tr>
<tr><td>H2</td><td><span class="sev h">HIGH</span></td><td>saveExam: 3 كتابات متسلسلة لكل طالب → امتحان 30 طالب = ~90 طلب متسلسل</td><td>N+1 writes</td></tr>
<tr><td>H3</td><td><span class="sev h">HIGH</span></td><td>markAllPresent / bulk present / absent: انتظار متسلسل لكل طالب (3 كتابات لكل طالب)</td><td>N×3 RTTs متسلسلة</td></tr>
<tr><td>H4</td><td><span class="sev h">HIGH</span></td><td>شعار SVG بحجم 594KB يظهر في كل صفحة + أيقونة التبويب تجلب PNG بحجم 708KB</td><td>SVG مولّد بـ VTracer بـ 1,509 مسار</td></tr>
<tr><td>H5</td><td><span class="sev h">HIGH</span></td><td>خطوط: @import مكرر لخط Cairo داخل CSS (شلال متسلسل) + خط Material Symbols كامل لأيقونة واحدة</td><td>2 × Google-Fonts @import في index.css</td></tr>
<tr><td>H6</td><td><span class="sev h">HIGH</span></td><td>exam_scores يُجلب بلا حد (ينمو للأبد) ويعاد تحميله مع كل loadAll</td><td>select بلا limit</td></tr>
<tr><td>M1</td><td><span class="sev m">MEDIUM</span></td><td>خلل صحّي: حضور 30/90 يوم في التحليلات دائمًا صفر — العمود attendance_date غير مضمّن في الـ select</td><td>تم إصلاحه ضمن جولة الأداء</td></tr>
<tr><td>M2-M7</td><td><span class="sev m">MEDIUM</span></td><td>بوابة أولياء الأمور: 3 RPC متسلسلة كل 10 ثوانٍ · تسريب قناة realtime بعد تبديل الحساب · sessionStudentsFor يعيد كائنات جديدة كل render · حذف التراجع الجماعي طلبًا لكل طالب · قيم Context غير memoized</td><td>كلها أُصلحت</td></tr>
<tr><td>L</td><td><span class="sev l">LOW</span></td><td>خطأ قديم في طبقة الإقلاع بـ index.html: IIFE بدون فاصلة منقوطة كان يُفسَّر كاستدعاء → TypeError يقتل شاشة البداية والمراقب على كل متصفح جديد</td><td>اكتُشف أثناء اختبارات الجولة وأُصلح</td></tr>
</table>

<h2>2) ما الذي تغيّر؟ (What was changed)</h2>
<div class="box">
<b>بيانات واستعلامات:</b> سلسلة الإقلاع صارت 3 دفعات متوازية بدل 5-6 متسلسلة، وفلترة أحداث المصادقة (لا إعادة تحميل مع TOKEN_REFRESHED) · refreshExamData مخصصة للامتحانات فقط مع throttle · حفظ الامتحان دفعة واحدة (insert مجمّع + نقاط متوازية) · الحضور الجماعي متوازٍ · attendance_date أُضيف للاستعلام (إصلاح التحليلات) · RPCs البوابة متوازية · حذف التراجع بطلب واحد <code>.in()</code>.
</div>
<div class="box">
<b>الرسم (Rendering):</b> فصل حالة الحفظ (وميض "جارٍ/تم الحفظ") في Context مستقل <code>useWorkspaceMeta()</code> — لم يعد كل ضغطة حضور تعيد رسم الشجرة 3 مرات · كل الدوال أصبحت مستقرة عبر refs · <code>sessionStudentsFor</code> مع ذاكرة حسب المدخلات · memo لقيم Auth/Settings/Language/Theme/Toast.
</div>
<div class="box">
<b>الحزمة والأصول:</b> React.lazy للصفحات غير الأساسية (بوابة QR، الأدمن، Onboarding، Signup/Reset/Status/Privacy، ماسح QR، الرسوم البيانية) · jspdf/qrcode/html2canvas تُحمَّل عند الطلب فقط داخل الدوال التي تحتاجها · خط Cairo متغير الوزن برابط واحد مع preconnect بدل استيرادين داخل CSS · حذف Material Symbols (SVG مضمّن) · الشعار 594KB ← 158KB بعد SVGO (تحقق بصري بفارق بكسل &lt;0.3/255) · أيقونة التبويب لم تعد تجلب 708KB · حذف 6.3MB أصول ميتة من public/ · حذف vite-plugin-pwa غير المستخدم · تنظيف ~102MB من المستودع.
</div>

<h2>3) القياسات: قبل / بعد (Measured before / after)</h2>
<h3>الحزمة (production build)</h3>
<table>
<tr><th>المؤشر</th><th>قبل</th><th>بعد</th><th>التحسين</th></tr>
<tr><td>الحزمة الرئيسية (minified)</td><td>2,027 KB</td><td><b>262 KB</b></td><td class="good">‎-87%</td></tr>
<tr><td>الحزمة الرئيسية (gzip)</td><td>605 KB</td><td><b>82 KB</b></td><td class="good">‎-86%</td></tr>
<tr><td>JS منقول عند الإقلاع (محلي)</td><td>594 KB</td><td><b>161 KB</b></td><td class="good">‎-73%</td></tr>
<tr><td>public/ على القرص</td><td>8.0 MB</td><td><b>508 KB</b></td><td class="good">‎-94%</td></tr>
<tr><td>المستودع (ملفات متتبعة)</td><td>~102 MB زائد</td><td><b>منظّف</b></td><td class="good">clone أسرع</td></tr>
</table>

<h3>الموقع المباشر (mobile 4× CPU + Fast 3G) — صفحات عامة</h3>
<table>
<tr><th>الصفحة</th><th>LCP قبل</th><th>LCP بعد</th><th>JS قبل</th><th>JS بعد</th><th>Long tasks قبل → بعد</th></tr>
<tr><td>الصفحة الرئيسية</td><td>596ms</td><td class="good">368-396ms</td><td>387KB</td><td class="good">214KB</td><td>1 → 1</td></tr>
<tr><td>تسجيل الدخول</td><td>180ms</td><td class="same">176-224ms (مماثل)</td><td>387KB</td><td class="good">214KB</td><td>2 → 0</td></tr>
<tr><td>بوابة أولياء الأمور /qr</td><td>1,664ms</td><td class="good">948-1,484ms</td><td>387KB</td><td class="good">226KB</td><td>2 → 0</td></tr>
<tr><td>الشعار المنقول (كل صفحة)</td><td>120KB</td><td class="good">38KB</td><td>—</td><td>—</td><td>—</td></tr>
</table>

<h3>البناء المحلي بوضع demo (نفس الجهاز، نفس الأداة)</h3>
<table>
<tr><th>السيناريو</th><th>قبل (LCP / JS / busy)</th><th>بعد (LCP / JS / busy)</th></tr>
<tr><td>Landing</td><td>420ms / 594KB / 169ms busy</td><td class="good">324ms / 161KB / 0ms busy</td></tr>
<tr><td>تسجيل الدخول ← اللوحة</td><td>368ms / 594KB / 173ms busy</td><td class="good">236ms / 161KB / 61ms busy</td></tr>
<tr><td>فتح Analytics (chart.js)</td><td>مضمّن في الإقلاع</td><td class="good">يُحمَّل عند الطلب (+70KB gzip فقط عند فتح التبويب)</td></tr>
<tr><td>فتح ماسح QR</td><td>مضمّن في الإقلاع</td><td class="good">يُحمَّل عند الطلب (+113KB gzip فقط عند فتح الماسح)</td></tr>
<tr><td>بوابة /qr على البناء المحلي</td><td>كل حزمة المدرس كاملة</td><td class="good">chunk مستقل 35KB (+ مكتبات عند الطلب فقط)</td></tr>
</table>

<h3>قاعدة البيانات / الشبكة (منطق الاستعلام — بالعدّ لا بالزمن)</h3>
<table>
<tr><th>العملية</th><th>قبل</th><th>بعد</th></tr>
<tr><td>إقلاع الجلسة (Auth)</td><td>5-6 طلبات متسلسلة × 2 (مكررة)</td><td class="good">3 دفعات متوازية × 1</td></tr>
<tr><td>حفظ امتحان 30 طالبًا</td><td>~90 طلبًا متسلسلًا + loadAll (6 جداول)</td><td class="good">3 طلبات مجمّعة + نقاط متوازية + refresh مخصص</td></tr>
<tr><td>تحديد "الكل حاضر" (30 طالبًا)</td><td>90 طلبًا متسلسلًا</td><td class="good">نفس الطلبات متوازية ≈ زمن طلب واحد</td></tr>
<tr><td>تعديل درجة طالب واحدة</td><td>loadAll كامل (6 جداول)</td><td class="good">2 استعلام (امتحانات + درجات)</td></tr>
<tr><td>حدث realtime للامتحانات</td><td>loadAll كامل</td><td class="good">استعلامان مع throttle 500ms</td></tr>
<tr><td>دورية بوابة أولياء الأمور (10ث)</td><td>3 RPC متسلسلة</td><td class="good">دفعة واحدة متوازية</td></tr>
<tr><td>تحليلات 30/90 يومًا</td><td class="warn">صفر دائمًا (خلل صحّي)</td><td class="good">تعمل correctly</td></tr>
</table>

<h2>4) لماذا تحسّن الأداء؟ (Why it improves)</h2>
<ul>
<li><b>حجم JS أقل = تحليل وتنفيذ أسرع على الهواتف الضعيفة:</b> الهاتف الذي كان يفكّ 605KB gzip في كل صفحة الآن يفكّ 82KB — والباقي يُحمَّل فقط عند فتح الميزة فعلاً.</li>
<li><b>توازٍ بدل التتابع:</b> الطلبات المستقلة صارت دفعات متوازية — زمن الحائط يصبح ≈ أبطأ طلب واحد بدل مجموع الطلبات.</li>
<li><b>رسومات أقل:</b> فصل حالة الحفظ عن البيانات يعني أن ضغطة "حاضر" تحدّث صف الطالب فقط بدل إعادة رسم كل الشاشة 3 مرات — مهم جدًا على الجوال أثناء الحصة.</li>
<li><b>لا إعادة تحميل شاملة:</b> تعديل درجة واحدة لم يعد يجلب 5,000 سجل حضور — الشبكة والبطارية والذاكرة كلها تستفيد.</li>
<li><b>أصول أخف:</b> الشعار الأمثل وخط واحد بدل اثنين يعني وصول المحتوى المرئي أسرع على شبكات 3G.</li>
</ul>

<h2>5) ما لم يتغير (بقصد) — حماية الوظائف</h2>
<ul>
<li>لم يُمس أي منطق أعمال، ولا صلاحيات، ولا RLS، ولا روابط QR أو Student Portal، ولا قاعدة البيانات (أي أخطاء قاعدة بيانات مطلوبة ستكون ملفات migration في المستودع فقط).</li>
<li>كل الميزات الإنتاجية الحديثة محفوظة: الجدول الزمني الأسبوعي، الجولة التفاعلية، البحث الشامل، مركز المساعدة، ترقية QR إلى EC-H/640px.</li>
<li>التراجع/الإعادة ما زال يستخدم loadAll الكامل (حدث نادر يبدأه المستخدم — الأولوية للصحة على السرعة هنا).</li>
<li>لا virtualization للقوائم: أحجام الفصول (عشرات) لا تبرر التعقيد.</li>
<li>لا caching لبيانات الحضور/الدرجات/الحصة النشطة — قاعدة البيانات تبقى مصدر الحقيقة (حماية صحة البيانات).</li>
</ul>

<h2>6) الاختبارات والتحقق</h2>
<ul>
<li><code>scripts/smoke-test.mjs</code>: كل التدفقات (دخول تجريبي، فتح حصة، حضور + تراجع، تفاعل، درجات، تقرير، كل المناطق، رسوم Analytics الكسولة، الوضع الليلي، اللغة، ملف الطالب) — <b>صفر أخطاء console/page</b>.</li>
<li>فحص بصري للشعار بعد SVGO بمقارنة بكسلية (متوسط الفرق 0.03-0.27 من 255 — غير محسوس).</li>
<li>تحقق مباشر على الإنتاج بعد النشر: الرئيسية + الدخول + الخصوصية + بوابة /qr تعمل بلا أخطاء.</li>
</ul>

<h2>7) عناقيد متبقية (Remaining bottlenecks)</h2>
<ul>
<li><span class="sev m">MEDIUM</span> <b>CLS بوابة أولياء الأمور ≈ 0.096</b>: نقل تخطي بعد تحميل البيانات (ارتفاع المحتوى يتغير). يحتاج هياكل محجوزة (skeleton placeholders) — تعديل تصميمي منفصل.</li>
<li><span class="sev m">MEDIUM</span> <b>حزمة الإقلاع يمكن تقليصها أكثر</b> (~82KB gzip): تقسيم قاموس i18n (ar/en) وتحميل اللغة غير النشطة عند الطلب + مراجعة animejs (يستخدم في مكانين صغيرين).</li>
<li><span class="sev m">MEDIUM</span> <b>كتابة نقاط الامتحان لكل طالب على حدة</b>: دمجها يتطلب دالة RPC جديدة في قاعدة البيانات (خارج نطاق "عدم تعديل Supabase"). جاهز كاقتراح migration عند السماح.</li>
<li><span class="sev l">LOW</span> <b>القوائم غير مُحاكاة (virtualized)</b>: ستصبح ذات قيمة فقط إذا تجاوزت الفصول مئات الطلاب فعليًا.</li>
<li><span class="sev l">LOW</span> <b>إبطاء مؤقت لأرقام LCP المباشرة</b>: أحصل على تفاوت بين التشغيلات على البوابة (LCP العنصر يتأثر بوقت وصول RPC) — الاتجاه الهيكلي واضح (JS نصف الحجم، صفر long tasks) لكن يُنصح بقياس أطول بمجال تردد ثابت (مثلاً عبر Lighthouse CI مجدول) لتثبيت الأرقام.</li>
</ul>

<div class="box" style="margin-top:20px">
<b>أدوات إعادة القياس مستقبلًا:</b> <code>node scripts/perf-measure.mjs --base=&lt;url&gt; --label=run --profile=mobile --out=perf-results/x.json</code> · اختبار الانحدار: <code>node scripts/smoke-test.mjs &lt;url&gt;</code> · تقرير العناقيد: <code>perf-results/BOTTLENECK-REPORT.md</code>
</div>

</body></html>`

const tmp = '/home/z/my-project/perf-results/final-report.html'
fs.writeFileSync(tmp, html)
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`file://${tmp}`, { waitUntil: 'load' })
const out = '/home/z/my-project/download/Alnokhba-Performance-Report-2026-09-19.pdf'
await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } })
await browser.close()
console.log(`report written: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`)
