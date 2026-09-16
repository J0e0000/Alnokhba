"use client";

import { useState } from "react";
import { Printer } from "lucide-react";

interface ReportData {
  student: {
    name: string;
    code: string | null;
    stage: string | null;
    group: { name: string } | null;
  };
  teacher: { fullName: string; centerName: string | null };
  attendance: {
    present: number;
    absent: number;
    total: number;
    rate: number;
    threshold: number;
    warn: boolean;
    recent: Array<{ status: string; lessonTitle: string; lessonDate: string }>;
  };
  examResults: Array<{ examTitle: string; score: number; maxScore: number; percentage: number; status: string }>;
  homework: Array<{ title: string; done: boolean; dueDate: string | null }>;
}

export function PrintReportButton({ data }: { data: ReportData }) {
  const [generating, setGenerating] = useState(false);

  const generate = () => {
    setGenerating(true);
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      alert("الرجاء السماح بالنوافذ المنبثقة لطباعة التقرير.");
      setGenerating(false);
      return;
    }
    const html = buildReportHTML(data);
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      win.print();
      setGenerating(false);
    }, 500);
  };

  return (
    <button
      onClick={generate}
      disabled={generating}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm font-bold hover:bg-primary/20 transition active:scale-95 disabled:opacity-60"
    >
      <Printer className="h-4 w-4" />
      {generating ? "جاري التحضير..." : "طباعة تقرير"}
    </button>
  );
}

function buildReportHTML(data: ReportData): string {
  const { student, teacher, attendance, examResults, homework } = data;
  const avgGrade = examResults.length
    ? Math.round(examResults.reduce((s, r) => s + r.percentage, 0) / examResults.length)
    : 0;
  const hwDone = homework.filter((h) => h.done).length;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تقرير ${student.name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
  * { font-family: 'Cairo', sans-serif; box-sizing: border-box; }
  body { margin: 0; padding: 24px; color: #0b1b33; background: #fff; }
  .header { background: linear-gradient(135deg, #001f43, #1f3a60); color: #fff; padding: 24px; border-radius: 16px; margin-bottom: 24px; }
  .header h1 { margin: 0 0 8px; font-size: 24px; }
  .header .sub { opacity: 0.85; font-size: 14px; }
  .student-card { display: flex; justify-content: space-between; padding: 16px; border: 1px solid #e3e8f1; border-radius: 12px; margin-bottom: 20px; }
  .student-info h2 { margin: 0 0 4px; font-size: 20px; }
  .student-info p { margin: 2px 0; color: #5b6678; font-size: 13px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .badge-warn { background: #fef2f2; color: #d92d20; }
  .badge-ok { background: #f0fdf4; color: #16a34a; }
  .section { margin-bottom: 24px; }
  .section h3 { color: #001f43; border-bottom: 2px solid #e0a813; padding-bottom: 6px; margin: 0 0 12px; font-size: 16px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .stat { text-align: center; padding: 12px; border: 1px solid #e3e8f1; border-radius: 8px; }
  .stat .val { font-size: 22px; font-weight: 800; }
  .stat .lbl { font-size: 11px; color: #5b6678; }
  .green { color: #16a34a; } .red { color: #d92d20; } .blue { color: #0891b2; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f6f7fb; padding: 8px; text-align: right; font-weight: 700; }
  td { padding: 8px; border-bottom: 1px solid #e3e8f1; }
  .bar { height: 6px; background: #e3e8f1; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e3e8f1; text-align: center; color: #5b6678; font-size: 12px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <h1>تقرير الطالب</h1>
    <div class="sub">${teacher.centerName || teacher.fullName} — ${new Date().toLocaleDateString("ar-EG")}</div>
  </div>

  <div class="student-card">
    <div class="student-info">
      <h2>${student.name}</h2>
      <p>الكود: ${student.code || "—"}</p>
      <p>المرحلة: ${student.stage || "—"}</p>
      <p>المجموعة: ${student.group?.name || "—"}</p>
    </div>
    <div>
      ${attendance.warn ? '<span class="badge badge-warn">إنذار غياب</span>' : '<span class="badge badge-ok">طبيعي</span>'}
    </div>
  </div>

  <div class="section">
    <h3>ملخص الحضور</h3>
    <div class="stats">
      <div class="stat"><div class="val green">${attendance.present}</div><div class="lbl">حاضر</div></div>
      <div class="stat"><div class="val red">${attendance.absent}</div><div class="lbl">غائب</div></div>
      <div class="stat"><div class="val">${attendance.total}</div><div class="lbl">إجمالي</div></div>
      <div class="stat"><div class="val blue">${attendance.rate}%</div><div class="lbl">نسبة الحضور</div></div>
    </div>
    <p style="font-size:12px;color:#5b6678;margin-top:8px;">حد الإنذار: ${attendance.threshold} غيابات</p>
  </div>

  <div class="section">
    <h3>نتائج الامتحانات</h3>
    ${examResults.length === 0 ? "<p>لا توجد نتائج.</p>" : `
    <table>
      <thead><tr><th>الامتحان</th><th>الدرجة</th><th>النسبة</th></tr></thead>
      <tbody>
        ${examResults.map((r) => `
          <tr>
            <td>${r.examTitle}</td>
            <td>${r.score} / ${r.maxScore}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="bar" style="flex:1;"><div class="bar-fill" style="width:${r.percentage}%;background:${r.percentage >= 50 ? "#16a34a" : "#d92d20"}"></div></div>
                <span style="font-weight:700;">${r.percentage}%</span>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`}
    <p style="font-size:12px;color:#5b6678;margin-top:8px;">متوسط الدرجات: <strong>${avgGrade}%</strong></p>
  </div>

  <div class="section">
    <h3>الواجبات</h3>
    ${homework.length === 0 ? "<p>لا توجد واجبات.</p>" : `
    <table>
      <thead><tr><th>الواجب</th><th>الحالة</th><th>التسليم</th></tr></thead>
      <tbody>
        ${homework.map((h) => `
          <tr>
            <td>${h.title}</td>
            <td>${h.done ? '<span class="badge badge-ok">تم</span>' : '<span class="badge badge-warn">لم يتم</span>'}</td>
            <td>${h.dueDate || "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>`}
    <p style="font-size:12px;color:#5b6678;margin-top:8px;">تم إنجاز: <strong>${hwDone} / ${homework.length}</strong></p>
  </div>

  <div class="footer">
    تم إنشاء هذا التقرير بواسطة منصة نُخبة — ${new Date().toLocaleDateString("ar-EG")}
  </div>
</body>
</html>`;
}
