"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ClipboardList,
  Pencil,
  Trash2,
  Send,
  Loader2,
  Award,
  TrendingUp,
  TrendingDown,
  BarChart3,
  CheckCircle2,
  XCircle,
  Lock,
  Megaphone,
  ListChecks,
} from "lucide-react";
import { AppShell, LoadingState, ErrorState, EmptyState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import {
  EXAM_STATUS_LABEL,
  EXAM_RESULT_STATUS_LABEL,
  formatArabicDate,
  pct,
} from "@/lib/arabic";
import { validateScore, normalizeDigits } from "@/lib/validation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface ExamQuestion {
  text: string;
  type: string;
  marks: number;
  choices?: string[];
  answer?: string;
}
interface ExamResult {
  id: string;
  studentId: string;
  studentName: string;
  studentCode: string | null;
  score: number;
  status: string;
  percentage: number;
  note: string | null;
  gradedAt: string | null;
}
interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  maxScore: number;
  passScore: number | null;
  status: string;
  lessonDate: string | null;
  publishedAt: string | null;
  group: { id: string; name: string; stage: string } | null;
  questions: ExamQuestion[];
  results: ExamResult[];
}

export default function ExamDetailPage() {
  return (
    <AppShell back="/exams">
      <ExamDetailContent />
    </AppShell>
  );
}

function ExamDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Local editable scores map: studentId -> string
  const [scores, setScores] = useState<Record<string, string>>({});
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});
  const [savingGrades, setSavingGrades] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<{ ok: boolean; exam?: ExamDetail; error?: string }>(
        `/api/exams/${id}`
      );
      if (d.ok && d.exam) {
        setExam(d.exam);
        const init: Record<string, string> = {};
        for (const r of d.exam.results) {
          init[r.studentId] = String(r.score ?? 0);
        }
        setScores(init);
        setScoreErrors({});
      } else {
        setError(d.error || "الامتحان غير موجود.");
      }
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الامتحان.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onScoreChange = (studentId: string, value: string) => {
    const cleaned = normalizeDigits(value);
    setScores((prev) => ({ ...prev, [studentId]: cleaned }));
    if (!exam) return;
    const n = Number(cleaned);
    if (cleaned === "") {
      setScoreErrors((prev) => ({ ...prev, [studentId]: "الدرجة مطلوبة." }));
    } else {
      const v = validateScore(n, exam.maxScore);
      setScoreErrors((prev) => ({
        ...prev,
        [studentId]: v.ok ? "" : v.error || "",
      }));
    }
  };

  const saveGrades = async () => {
    if (!exam) return;
    const results: Array<{ studentId: string; score: number; status: "graded" }> = [];
    let hasError = false;
    for (const r of exam.results) {
      const raw = scores[r.studentId] ?? "";
      const n = Number(normalizeDigits(raw));
      const v = validateScore(n, exam.maxScore);
      if (!v.ok || !Number.isFinite(n)) {
        hasError = true;
        setScoreErrors((prev) => ({
          ...prev,
          [r.studentId]: v.error || "قيمة غير صحيحة.",
        }));
      } else {
        results.push({ studentId: r.studentId, score: n, status: "graded" });
      }
    }
    if (hasError) {
      toast.error("هناك درجات غير صحيحة. صححها ثم أعد المحاولة.");
      return;
    }
    if (results.length === 0) {
      toast.error("لا توجد نتائج للحفظ.");
      return;
    }
    setSavingGrades(true);
    try {
      await apiFetch(`/api/exams/${id}/results`, {
        method: "PUT",
        json: { results },
      });
      toast.success("تم حفظ الدرجات وإشعار أولياء الأمور.");
      load();
    } catch (e: any) {
      toast.error(e.message || "تعذّر حفظ الدرجات.");
    } finally {
      setSavingGrades(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      await apiFetch(`/api/exams/${id}`, {
        method: "PATCH",
        json: { status: "published" },
      });
      toast.success("تم نشر الامتحان.");
      load();
    } catch (e: any) {
      toast.error(e.message || "تعذّر النشر.");
    } finally {
      setPublishing(false);
    }
  };

  const removeExam = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/api/exams/${id}`, { method: "DELETE" });
      toast.success("تم حذف الامتحان.");
      router.push("/exams");
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحذف.");
    } finally {
      setDeleting(false);
    }
  };

  const stats = useMemo(() => {
    if (!exam) return null;
    const graded = exam.results;
    if (graded.length === 0) {
      return { count: 0, avg: 0, max: 0, min: 0, passRate: 0, distribution: [] as number[] };
    }
    const scores = graded.map((r) => r.score);
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = sum / scores.length;
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const passCount = exam.passScore
      ? scores.filter((s) => s >= exam.passScore!).length
      : 0;
    const passRate = Math.round((passCount / graded.length) * 100);
    // distribution: 0-20%, 20-40%, ..., 80-100%
    const buckets = [0, 0, 0, 0, 0];
    for (const s of scores) {
      const p = (s / exam.maxScore) * 100;
      const idx = Math.min(4, Math.floor(p / 20));
      buckets[idx]++;
    }
    return {
      count: graded.length,
      avg: Math.round(avg * 100) / 100,
      max,
      min,
      passRate,
      distribution: buckets,
    };
  }, [exam]);

  if (loading) return <LoadingState label="جاري تحميل الامتحان..." />;
  if (error || !exam)
    return <ErrorState message={error || "الامتحان غير موجود."} onRetry={load} />;

  const statusInfo = getStatusInfo(exam.status);
  const hasGraded = exam.results.some((r) => r.status === "graded");

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Header */}
      <section className="rounded-2xl bg-card border border-border p-4 animate-fade-in-up">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-black text-lg leading-tight">{exam.title}</h2>
              <span className={`status-chip ${statusInfo.cls}`}>{statusInfo.label}</span>
            </div>
            {exam.group && (
              <p className="text-sm text-muted-foreground mt-1">
                {exam.group.name} · {exam.group.stage}
              </p>
            )}
            {exam.description && (
              <p className="text-sm mt-2 leading-relaxed">{exam.description}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Award className="h-3.5 w-3.5" />
                الدرجة العظمى: <span className="font-bold ltr-nums">{exam.maxScore}</span>
              </span>
              {exam.passScore !== null && (
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  النجاح: <span className="font-bold ltr-nums">{exam.passScore}</span>
                </span>
              )}
              {exam.lessonDate && (
                <span className="inline-flex items-center gap-1">
                  {formatArabicDate(exam.lessonDate)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted transition active:scale-95"
          >
            <Pencil className="h-4 w-4" />
            تعديل
          </button>
          {exam.status === "draft" && (
            <button
              type="button"
              onClick={publish}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:opacity-90 transition active:scale-95 disabled:opacity-60"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
              نشر
            </button>
          )}
          {exam.status === "published" && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await apiFetch(`/api/exams/${id}`, {
                    method: "PATCH",
                    json: { status: "closed" },
                  });
                  toast.success("تم إغلاق الامتحان.");
                  load();
                } catch (e: any) {
                  toast.error(e.message || "تعذّر الإغلاق.");
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted text-muted-foreground text-sm font-bold hover:opacity-90 transition active:scale-95"
            >
              <Lock className="h-4 w-4" />
              إغلاق
            </button>
          )}
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-400 text-sm font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 transition active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
            حذف
          </button>
        </div>
      </section>

      {hasGraded && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          النتيجة متاحة للطلاب وأولياء الأمور — تم إرسال الإشعارات تلقائيًا.
        </div>
      )}

      <Tabs defaultValue="results" className="w-full">
        <TabsList className="w-full grid grid-cols-3 h-10">
          <TabsTrigger value="results">النتائج</TabsTrigger>
          <TabsTrigger value="questions">الأسئلة</TabsTrigger>
          <TabsTrigger value="stats">الإحصاءات</TabsTrigger>
        </TabsList>

        {/* Results tab */}
        <TabsContent value="results" className="mt-3 space-y-3">
          {exam.results.length === 0 ? (
            <EmptyState
              icon={Award}
              title="لا يوجد طلاب"
              description="لا توجد نتائج. تأكد من أن المجموعة تحتوي على طلاب."
            />
          ) : (
            <>
              <div className="rounded-2xl bg-card border border-border p-3 space-y-2">
                {exam.results.map((r) => {
                  const raw = scores[r.studentId] ?? "";
                  const err = scoreErrors[r.studentId];
                  const percent = pct(Number(normalizeDigits(raw)) || 0, exam.maxScore);
                  const passed =
                    exam.passScore !== null &&
                    Number(normalizeDigits(raw)) >= exam.passScore;
                  return (
                    <div
                      key={r.id}
                      className="rounded-xl border border-border p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{r.studentName}</p>
                          {r.studentCode && (
                            <p className="text-xs text-muted-foreground ltr-nums">
                              #{r.studentCode}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Input
                            inputMode="decimal"
                            value={raw}
                            onChange={(e) => onScoreChange(r.studentId, e.target.value)}
                            className="w-20 h-9 text-center"
                            dir="ltr"
                            placeholder="0"
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            / <span className="ltr-nums">{exam.maxScore}</span>
                          </span>
                        </div>
                      </div>
                      {/* percentage bar */}
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            passed ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span
                          className={`status-chip ${
                            passed
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : exam.passScore !== null
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {exam.passScore !== null
                            ? passed
                              ? "ناجح"
                              : "راسب"
                            : EXAM_RESULT_STATUS_LABEL[r.status] || r.status}
                        </span>
                        <span className="text-muted-foreground ltr-nums">
                          {percent}%
                        </span>
                      </div>
                      {err && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400">{err}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={saveGrades}
                disabled={savingGrades}
                className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition disabled:opacity-60"
              >
                {savingGrades ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                حفظ الدرجات
              </button>
            </>
          )}
        </TabsContent>

        {/* Questions tab */}
        <TabsContent value="questions" className="mt-3">
          {exam.questions.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="لا توجد أسئلة"
              description="لم تتم إضافة أسئلة لهذا الامتحان."
            />
          ) : (
            <div className="space-y-2">
              {exam.questions.map((q, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-card border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-muted-foreground">
                        سؤال {i + 1} · {qTypeLabel(q.type)}
                      </p>
                      <p className="text-sm font-medium mt-1">{q.text}</p>
                    </div>
                    <span className="status-chip bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 ltr-nums">
                      {q.marks} درجة
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Stats tab */}
        <TabsContent value="stats" className="mt-3 space-y-3">
          {!stats || stats.count === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="لا توجد إحصاءات بعد"
              description="ستظهر الإحصاءات بعد حفظ الدرجات."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={TrendingUp}
                  label="المتوسط"
                  value={String(stats.avg)}
                  accent="emerald"
                />
                <StatCard
                  icon={Award}
                  label="أعلى درجة"
                  value={String(stats.max)}
                  accent="gold"
                />
                <StatCard
                  icon={TrendingDown}
                  label="أقل درجة"
                  value={String(stats.min)}
                  accent="rose"
                />
                <StatCard
                  icon={CheckCircle2}
                  label="نسبة النجاح"
                  value={`${stats.passRate}%`}
                  accent="emerald"
                />
              </div>

              <section className="rounded-2xl bg-card border border-border p-4">
                <h3 className="font-bold text-sm flex items-center gap-1.5 mb-3">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  توزيع الدرجات
                </h3>
                <div className="flex items-end justify-between gap-2 h-32">
                  {stats.distribution.map((count, i) => {
                    const max = Math.max(...stats.distribution, 1);
                    const h = (count / max) * 100;
                    const label = `${i * 20}–${i * 20 + 20}%`;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs font-bold ltr-nums">{count}</span>
                        <div className="w-full bg-muted rounded-t-md overflow-hidden flex-1 flex items-end">
                          <div
                            className="w-full bg-primary transition-all"
                            style={{ height: `${h}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground ltr-nums">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl bg-card border border-border p-4 text-sm">
                <p className="text-muted-foreground">
                  عدد الطلاب: <span className="font-bold ltr-nums">{stats.count}</span>
                </p>
              </section>
            </>
          )}
        </TabsContent>
      </Tabs>

      <div className="h-2" />

      <EditExamDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        exam={exam}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف الامتحان وكل نتائجه نهائيًا. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeExam}
              disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent: "emerald" | "gold" | "rose";
}) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    gold: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
  };
  return (
    <div className="rounded-2xl bg-card border border-border p-3 flex items-center gap-3">
      <div className={`grid place-items-center h-10 w-10 rounded-xl ${map[accent]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-black text-lg ltr-nums">{value}</p>
      </div>
    </div>
  );
}

function getStatusInfo(status: string): { label: string; cls: string } {
  switch (status) {
    case "published":
      return {
        label: EXAM_STATUS_LABEL.published,
        cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
      };
    case "closed":
      return {
        label: EXAM_STATUS_LABEL.closed,
        cls: "bg-muted text-muted-foreground",
      };
    default:
      return {
        label: EXAM_STATUS_LABEL.draft,
        cls: "bg-muted text-muted-foreground",
      };
  }
}

function qTypeLabel(type: string): string {
  switch (type) {
    case "mcq":
      return "اختيار من متعدد";
    case "true_false":
      return "صح / خطأ";
    case "short_answer":
      return "إجابة قصيرة";
    case "essay":
      return "مقال";
    default:
      return type;
  }
}

function EditExamDialog({
  open,
  onOpenChange,
  exam,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  exam: ExamDetail;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(exam.title);
  const [description, setDescription] = useState(exam.description || "");
  const [maxScore, setMaxScore] = useState(String(exam.maxScore));
  const [passScore, setPassScore] = useState(
    exam.passScore !== null ? String(exam.passScore) : ""
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(exam.title);
      setDescription(exam.description || "");
      setMaxScore(String(exam.maxScore));
      setPassScore(exam.passScore !== null ? String(exam.passScore) : "");
    }
  }, [open, exam]);

  const submit = async () => {
    if (title.trim().length < 3) return toast.error("العنوان قصير جدًا.");
    const maxN = Number(normalizeDigits(maxScore));
    if (!Number.isFinite(maxN) || maxN <= 0) return toast.error("الدرجة العظمى غير صحيحة.");
    let passN: number | null = null;
    if (passScore.trim()) {
      passN = Number(normalizeDigits(passScore));
      const v = validateScore(passN, maxN);
      if (!v.ok) return toast.error(v.error!);
    }
    setSaving(true);
    try {
      await apiFetch(`/api/exams/${exam.id}`, {
        method: "PATCH",
        json: {
          title: title.trim(),
          description: description.trim() || null,
          maxScore: maxN,
          passScore: passN,
        },
      });
      toast.success("تم حفظ التعديلات.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل الامتحان</DialogTitle>
          <DialogDescription>تعديل العنوان والوصف والدرجات.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>العنوان</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label>الوصف</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>الدرجة العظمى</Label>
              <Input
                inputMode="numeric"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                className="h-11"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>درجة النجاح</Label>
              <Input
                inputMode="numeric"
                value={passScore}
                onChange={(e) => setPassScore(e.target.value)}
                className="h-11"
                dir="ltr"
                placeholder="اختياري"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-muted transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
