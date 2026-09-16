"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  Plus,
  Loader2,
  Trash2,
  ArrowRight,
  ListChecks,
} from "lucide-react";
import { AppShell, EmptyState, LoadingState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { validateScore, normalizeDigits } from "@/lib/validation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface GroupItem {
  id: string;
  name: string;
  stage: string;
}

type QType = "mcq" | "true_false" | "short_answer" | "essay";
interface QuestionDraft {
  id: string;
  text: string;
  type: QType;
  marks: number;
}

const Q_TYPE_LABELS: Record<QType, string> = {
  mcq: "اختيار من متعدد",
  true_false: "صح / خطأ",
  short_answer: "إجابة قصيرة",
  essay: "مقال",
};

export default function ExamNewPage() {
  return (
    <AppShell back="/exams" title="إنشاء امتحان">
      <ExamNewContent />
    </AppShell>
  );
}

function ExamNewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetGroupId = searchParams.get("groupId") || "";
  const presetLessonDate = searchParams.get("lessonDate") || "";

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState<string>(presetGroupId);
  const [maxScore, setMaxScore] = useState("20");
  const [passScore, setPassScore] = useState("");
  const [lessonDate, setLessonDate] = useState(presetLessonDate);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [publishNow, setPublishNow] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const d = await apiFetch<{ ok: boolean; groups: GroupItem[] }>("/api/groups");
      if (d.ok) {
        setGroups(d.groups);
        if (!groupId && d.groups.length > 0) {
          // don't auto-pick — let user choose unless preset
        }
      }
    } catch (e: any) {
      toast.error(e.message || "تعذّر تحميل المجموعات.");
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        text: "",
        type: "mcq",
        marks: 1,
      },
    ]);
  };

  const updateQuestion = (id: string, patch: Partial<QuestionDraft>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const removeQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const submit = async () => {
    if (title.trim().length < 3) return toast.error("العنوان يجب أن يكون 3 أحرف على الأقل.");
    if (!groupId) return toast.error("اختر المجموعة.");
    const maxN = Number(normalizeDigits(maxScore));
    const maxCheck = validateScore(maxN, Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(maxN) || maxN <= 0) {
      return toast.error("الدرجة العظمى يجب أن تكون رقمًا موجبًا.");
    }
    if (maxCheck && !maxCheck.ok && maxN > Number.MAX_SAFE_INTEGER) {
      // unreachable; just guard
    }
    let passN: number | null = null;
    if (passScore.trim()) {
      passN = Number(normalizeDigits(passScore));
      const pc = validateScore(passN, maxN);
      if (!pc.ok) return toast.error(pc.error!);
    }

    // validate questions
    for (const q of questions) {
      if (q.text.trim().length < 2) {
        return toast.error("نص كل سؤال يجب أن يكون حرفين على الأقل.");
      }
      if (!Number.isFinite(q.marks) || q.marks < 0) {
        return toast.error("درجة السؤال غير صحيحة.");
      }
    }

    setSaving(true);
    try {
      const d = await apiFetch<{ ok: boolean; exam?: { id: string }; error?: string }>(
        "/api/exams",
        {
          method: "POST",
          json: {
            title: title.trim(),
            description: description.trim() || undefined,
            groupId,
            maxScore: maxN,
            passScore: passN,
            lessonDate: lessonDate || undefined,
            status: publishNow ? "published" : "draft",
            questions: questions.map((q) => ({
              text: q.text.trim(),
              type: q.type,
              marks: Number(q.marks),
            })),
          },
        }
      );
      if (d.ok && d.exam) {
        toast.success(publishNow ? "تم إنشاء الامتحان ونشره." : "تم إنشاء الامتحان كمسودة.");
        router.push(`/exams/${d.exam.id}`);
      } else {
        throw new Error(d.error || "تعذّر الإنشاء.");
      }
    } catch (e: any) {
      toast.error(e.message || "تعذّر إنشاء الامتحان.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingGroups) {
    return <LoadingState label="جاري تحميل المجموعات..." />;
  }

  return (
    <div className="px-4 pt-4 space-y-4">
      {groups.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="لا توجد مجموعات"
          description="أنشئ مجموعة أولًا قبل إنشاء امتحان."
          action={
            <Link
              href="/groups"
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold"
            >
              إضافة مجموعة
            </Link>
          }
        />
      ) : (
        <>
          <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
            <div className="space-y-1.5">
              <Label>عنوان الامتحان *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: امتحان الفصل الأول"
                className="h-11"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>المجموعة *</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="w-full h-11">
                  <SelectValue placeholder="اختر المجموعة" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} · {g.stage}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                سيتم إنشاء سجل نتيجة فارغ لكل طالب في المجموعة.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>الوصف (اختياري)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="ملاحظات أو تعليمات للامتحان..."
                rows={3}
                maxLength={500}
              />
            </div>
          </section>

          <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الدرجة العظمى *</Label>
                <Input
                  inputMode="numeric"
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  className="h-11"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label>درجة النجاح (اختياري)</Label>
                <Input
                  inputMode="numeric"
                  value={passScore}
                  onChange={(e) => setPassScore(e.target.value)}
                  placeholder="مثال: 10"
                  className="h-11"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ الامتحان (اختياري)</Label>
              <Input
                type="date"
                value={lessonDate}
                onChange={(e) => setLessonDate(e.target.value)}
                className="h-11"
              />
            </div>
          </section>

          {/* Questions builder */}
          <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <ListChecks className="h-4 w-4 text-violet-600" />
                الأسئلة ({questions.length})
              </h3>
              <button
                type="button"
                onClick={addQuestion}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 active:scale-95 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة سؤال
              </button>
            </div>
            {questions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">
                الأسئلة اختيارية. يمكنك إضافتها لاحقًا أو الاكتفاء بإدخال الدرجات مباشرة.
              </p>
            ) : (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <div
                    key={q.id}
                    className="rounded-xl border border-border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">
                        سؤال {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeQuestion(q.id)}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                        aria-label="حذف السؤال"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Input
                      value={q.text}
                      onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                      placeholder="نص السؤال..."
                      className="h-10"
                      maxLength={300}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        value={q.type}
                        onValueChange={(v) => updateQuestion(q.id, { type: v as QType })}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(Q_TYPE_LABELS) as QType[]).map((t) => (
                            <SelectItem key={t} value={t}>
                              {Q_TYPE_LABELS[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="numeric"
                        value={String(q.marks)}
                        onChange={(e) => {
                          const n = Number(normalizeDigits(e.target.value));
                          updateQuestion(q.id, {
                            marks: Number.isFinite(n) && n >= 0 ? n : 0,
                          });
                        }}
                        placeholder="الدرجة"
                        className="h-10"
                        dir="ltr"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Publish toggle */}
          <section className="rounded-2xl bg-card border border-border p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(e) => setPublishNow(e.target.checked)}
                className="h-5 w-5 accent-primary"
              />
              <div className="flex-1">
                <p className="font-bold text-sm">نشر الامتحان فورًا</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  إذا لم يُفعّل، سيُحفظ كمسودة ويمكن نشره لاحقًا.
                </p>
              </div>
            </label>
          </section>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="flex-1 h-12 rounded-2xl font-bold"
              onClick={() => router.push("/exams")}
              disabled={saving}
            >
              إلغاء
            </Button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ClipboardList className="h-5 w-5" />
                  حفظ الامتحان
                </>
              )}
            </button>
          </div>
          <div className="h-2" />
        </>
      )}
    </div>
  );
}
