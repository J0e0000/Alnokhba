"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { AppShell, InlineLoading } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";

interface GroupItem {
  id: string;
  name: string;
  stage: string;
}

interface ImportRow {
  name: string;
  phone: string;
  stage: string;
  groupId: string;
  errors: string[];
  valid: boolean;
}

export default function ImportStudentsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [defaultGroup, setDefaultGroup] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    apiFetch<{ ok: boolean; groups: GroupItem[] }>("/api/groups").then((d) => setGroups(d.groups || [])).catch(() => {});
  }, []);

  const parseFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
      const parsed = json.map((r) => ({
        name: String(r["الاسم"] || r["name"] || r["Name"] || "").trim(),
        phone: String(r["الهاتف"] || r["phone"] || r["Phone"] || "").trim(),
        stage: String(r["المرحلة"] || r["stage"] || r["Stage"] || "").trim(),
        groupId: "",
        errors: [] as string[],
        valid: true,
      }));
      setRows(parsed);
      if (parsed.length === 0) toast.error("لم يتم العثور على بيانات في الملف.");
    } catch {
      toast.error("تعذّر قراءة الملف. تأكد من صيغة Excel أو CSV.");
    }
  };

  const parsePaste = () => {
    const lines = pasteText.trim().split("\n");
    const parsed: ImportRow[] = lines.filter((l) => l.trim()).map((line) => {
      const parts = line.split(/[,\t،]/).map((p) => p.trim());
      return { name: parts[0] || "", phone: parts[1] || "", stage: parts[2] || "", groupId: "", errors: [], valid: true };
    });
    setRows(parsed);
    if (parsed.length === 0) toast.error("لا توجد بيانات للتحليل.");
  };

  const validate = async () => {
    if (!rows || rows.length === 0) return;
    setValidating(true);
    try {
      const d = await apiFetch<{ ok: boolean; rows: ImportRow[]; summary: any }>("/api/import/students", {
        method: "POST",
        json: { rows, groupId: defaultGroup || null },
      });
      setRows(d.rows);
      toast.success(`تم التحليل: ${d.summary.valid} صالح، ${d.summary.errors} به أخطاء.`);
    } catch (e: any) {
      toast.error(e.message || "تعذّر التحليل.");
    } finally {
      setValidating(false);
    }
  };

  const confirmImport = async () => {
    if (!rows) return;
    const validRows = rows.filter((r) => r.valid);
    if (validRows.length === 0) { toast.error("لا توجد صفوف صالحة."); return; }
    setImporting(true);
    try {
      const d = await apiFetch<{ ok: boolean; created: number }>("/api/import/students", {
        method: "PUT",
        json: { rows: validRows },
      });
      toast.success(`تم استيراد ${d.created} طالب بنجاح.`);
      router.push("/students");
    } catch (e: any) {
      toast.error(e.message || "تعذّر الاستيراد.");
    } finally {
      setImporting(false);
    }
  };

  const updateRow = (idx: number, field: keyof ImportRow, value: string) => {
    setRows((rs) => rs ? rs.map((r, i) => i === idx ? { ...r, [field]: value, errors: [], valid: true } : r) : null);
  };

  const validCount = rows?.filter((r) => r.valid).length || 0;
  const errorCount = rows ? rows.length - validCount : 0;

  return (
    <AppShell back="/students" title="استيراد طلاب">
      <div className="px-4 pt-4 space-y-4">
        {!rows && (
          <>
            <div className="rounded-2xl bg-card border border-border p-5">
              <h3 className="font-bold mb-3">الخطوة 1: رفع الملف</h3>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                ارفع ملف Excel أو CSV يحتوي على أعمدة: الاسم، الهاتف، المرحلة. أو الصق البيانات يدويًا.
              </p>
              <label className="block">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} className="hidden" />
                <span className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-border hover:border-primary/40 cursor-pointer transition">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm font-bold">اختر ملف Excel / CSV</span>
                  <span className="text-xs text-muted-foreground">xlsx, xls, csv</span>
                </span>
              </label>
            </div>

            <div className="rounded-2xl bg-card border border-border p-5">
              <h3 className="font-bold mb-3">أو الصق البيانات</h3>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"الاسم، الهاتف، المرحلة\nأحمد محمد، 01012345678، ثانوي\nمحمود علي، 01098765432، ثانوي"}
                className="w-full h-32 px-3 py-2 rounded-xl bg-background border border-input text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                dir="auto"
              />
              <button onClick={parsePaste} disabled={!pasteText.trim()} className="mt-2 w-full py-2.5 rounded-xl bg-muted font-bold text-sm hover:bg-muted/70 disabled:opacity-50 transition">
                تحليل النص
              </button>
            </div>

            <div className="rounded-2xl bg-card border border-border p-5">
              <h3 className="font-bold mb-2">المجموعة الافتراضية (اختياري)</h3>
              <select value={defaultGroup} onChange={(e) => setDefaultGroup(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm">
                <option value="">— بدون —</option>
                {groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
            </div>
          </>
        )}

        {rows && (
          <>
            <div className="rounded-2xl bg-card border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold">الخطوة 2: مراجعة البيانات</h3>
                <button onClick={() => setRows(null)} className="text-xs text-muted-foreground hover:text-foreground">إعادة</button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/60 py-2"><div className="font-black ltr-nums">{rows.length}</div><div className="text-[10px] text-muted-foreground">إجمالي</div></div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 py-2"><div className="font-black text-emerald-600 ltr-nums">{validCount}</div><div className="text-[10px] text-emerald-700/70">صالح</div></div>
                <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 py-2"><div className="font-black text-rose-600 ltr-nums">{errorCount}</div><div className="text-[10px] text-rose-700/70">أخطاء</div></div>
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={idx} className={`rounded-xl border p-3 ${r.valid ? "bg-card border-border" : "bg-rose-50/50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900"}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-muted-foreground ltr-nums">صف {idx + 1}</span>
                    {r.valid ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-rose-500" />}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <input value={r.name} onChange={(e) => updateRow(idx, "name", e.target.value)} placeholder="الاسم" className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm" dir="auto" />
                    <input value={r.phone} onChange={(e) => updateRow(idx, "phone", e.target.value)} placeholder="الهاتف" className="w-full px-3 py-2 rounded-lg bg-background border border-input text-sm ltr-nums" dir="ltr" />
                  </div>
                  {r.errors.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {r.errors.map((err, i) => (<li key={i} className="text-xs text-rose-600 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {err}</li>))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 sticky bottom-20">
              <button onClick={validate} disabled={validating} className="py-3 rounded-xl bg-muted font-bold text-sm hover:bg-muted/70 disabled:opacity-60 transition">
                {validating ? <InlineLoading label="تحليل..." /> : "إعادة التحليل"}
              </button>
              <button onClick={confirmImport} disabled={importing || validCount === 0} className="py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 disabled:opacity-60 transition">
                {importing ? <InlineLoading label="استيراد..." /> : `تأكيد (${validCount})`}
              </button>
            </div>
          </>
        )}
        <div className="h-4" />
      </div>
    </AppShell>
  );
}
