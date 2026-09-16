"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  Pencil,
  QrCode,
  RefreshCw,
  Phone,
  Calendar,
  ClipboardList,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  MessageCircle,
  Send,
} from "lucide-react";
import { AppShell, LoadingState, ErrorState, EmptyState } from "@/components/app-shell";
import { PrintReportButton } from "@/components/print-report";
import { apiFetch } from "@/lib/api-client";
import { ATTENDANCE_LABEL, ATTENDANCE_COLOR, timeAgo, pct } from "@/lib/arabic";
import { STAGES, validatePhone } from "@/lib/validation";

interface StudentDetail {
  ok: boolean;
  student: {
    id: string;
    name: string;
    phone: string | null;
    stage: string | null;
    code: string | null;
    orderIdx: number;
    group: { id: string; name: string; stage: string } | null;
    attendance: { status: string; lesson: { id: string; title: string; lessonDate: string } | null; method: string; recordedAt: string }[];
    results: { id: string; score: number; status: string; note: string | null; gradedAt: string | null; exam: { id: string; title: string; maxScore: number; status: string } }[];
    hwStatus: { id: string; done: boolean; updatedAt: string; homework: { id: string; title: string; dueDate: string | null } }[];
    qrToken: string | null;
    attendanceSummary: { present: number; absent: number; total: number; rate: number; warn: boolean; threshold: number };
  };
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<StudentDetail["student"] | null>(null);
  const [teacher, setTeacher] = useState<{ fullName: string; centerName: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "attendance" | "grades" | "homework">("overview");
  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [sendMsgOpen, setSendMsgOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<StudentDetail>(`/api/students/${params.id}`);
      setData(d.student);
      // fetch teacher info for the print report
      const me = await apiFetch<{ ok: boolean; teacher: { fullName: string; centerName: string | null } }>("/api/auth/me");
      if (me.ok) setTeacher(me.teacher);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل بيانات الطالب.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const openQR = async () => {
    setShowQR(true);
    if (data?.qrToken) {
      const url = await QRCode.toDataURL(`${window.location.origin}/qr/${data.qrToken}`, {
        width: 280,
        margin: 2,
        color: { dark: "#001f43", light: "#ffffff" },
      });
      setQrUrl(url);
    }
  };

  const regenerateQR = async () => {
    try {
      const d = await apiFetch<{ ok: boolean; token: string }>(`/api/students/${params.id}/qr`, {
        method: "POST",
      });
      toast.success("تم توليد رمز QR جديد.");
      const url = await QRCode.toDataURL(`${window.location.origin}/qr/${d.token}`, {
        width: 280,
        margin: 2,
        color: { dark: "#001f43", light: "#ffffff" },
      });
      setQrUrl(url);
      load();
    } catch (e: any) {
      toast.error(e.message || "تعذّر توليد الرمز.");
    }
  };

  if (loading) return <AppShell back="/students"><LoadingState label="جاري التحميل..." /></AppShell>;
  if (error || !data) return <AppShell back="/students"><ErrorState message={error || "الطالب غير موجود."} onRetry={load} /></AppShell>;

  const { present, absent, total, rate, warn, threshold } = data.attendanceSummary;
  const avgGrade = data.results.length
    ? Math.round(
        (data.results.reduce((s, r) => s + pct(r.score, r.exam.maxScore), 0) / data.results.length) * 10
      ) / 10
    : 0;
  const hwDone = data.hwStatus.filter((h) => h.done).length;

  return (
    <AppShell back="/students" title={data.name} subtitle={data.group?.name}>
      <div className="px-4 pt-4 space-y-4">
        {/* Student card */}
        <div className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-black">{data.name}</h2>
                {data.code && <span className="status-chip bg-muted text-muted-foreground">{data.code}</span>}
                {warn && (
                  <span className="status-chip bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                    <AlertTriangle className="h-3 w-3" /> إنذار
                  </span>
                )}
              </div>
              {data.group && <p className="text-sm text-muted-foreground mt-1">{data.group.name}</p>}
              {data.phone && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  <span className="ltr-nums">{data.phone}</span>
                </p>
              )}
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => setSendMsgOpen(true)} className="grid place-items-center h-10 w-10 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition" aria-label="إرسال رسالة">
                <Send className="h-4 w-4" />
              </button>
              <button onClick={() => setEditOpen(true)} className="grid place-items-center h-10 w-10 rounded-xl bg-muted hover:bg-muted/70 transition" aria-label="تعديل">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={openQR} className="grid place-items-center h-10 w-10 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition" aria-label="QR">
                <QrCode className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard label="حاضر" value={present} accent="emerald" />
          <StatCard label="غائب" value={absent} accent="rose" />
          <StatCard label="نسبة" value={`${rate}%`} accent="cyan" />
          <StatCard label="متوسط" value={`${avgGrade}%`} accent="violet" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {[
            { k: "overview", l: "نظرة عامة" },
            { k: "attendance", l: "الحضور" },
            { k: "grades", l: "الدرجات" },
            { k: "homework", l: "الواجبات" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as any)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition ${
                tab === t.k
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "overview" && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> ملخص الأداء</h3>
                <PrintReportButton
                  data={{
                    student: { name: data.name, code: data.code, stage: data.stage, group: data.group },
                    teacher: { fullName: teacher?.fullName || "", centerName: teacher?.centerName || null },
                    attendance: { present, absent, total, rate, threshold, warn, recent: [] },
                    examResults: data.results.map((r) => ({ examTitle: r.exam.title, score: r.score, maxScore: r.exam.maxScore, percentage: pct(r.score, r.exam.maxScore), status: r.status })),
                    homework: data.hwStatus.map((h) => ({ title: h.homework.title, done: h.done, dueDate: h.homework.dueDate })),
                  }}
                />
              </div>
              <Row label="إجمالي الحصص" value={String(total)} />
              <Row label="نسبة الحضور" value={`${rate}%`} />
              <Row label="عدد الغياب" value={String(absent)} accent={absent >= threshold ? "rose" : undefined} />
              <Row label="حد الإنذار" value={`${threshold} غياب`} />
              <Row label="الواجبات المنجزة" value={`${hwDone} / ${data.hwStatus.length}`} />
              <Row label="متوسط الدرجات" value={`${avgGrade}%`} />
            </div>
            {warn && (
              <div className="rounded-2xl bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 p-4">
                <div className="flex items-center gap-2 font-bold text-rose-700 dark:text-rose-400">
                  <AlertTriangle className="h-5 w-5" /> حالة الإنذار
                </div>
                <p className="text-sm text-rose-700/80 dark:text-rose-400/80 mt-1 leading-relaxed">
                  وصل الطالب إلى {absent} حالات غياب (حد الإنذار {threshold}). يُنصح بمتابعة الحالة.
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "attendance" && (
          <div className="space-y-2">
            {data.attendance.length === 0 ? (
              <EmptyState icon={Calendar} title="لا يوجد سجل حضور" description="لم يتم تسجيل حضور لهذا الطالب بعد." />
            ) : (
              data.attendance.map((a) => (
                <div key={a.lesson?.id + a.recordedAt} className="rounded-xl bg-card border border-border p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{a.lesson?.title || "حصة"}</p>
                    <p className="text-xs text-muted-foreground ltr-nums">{a.lesson?.lessonDate}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(a.recordedAt)} · {a.method === "qr" ? "QR" : a.method === "auto" ? "تلقائي" : "يدوي"}</p>
                  </div>
                  <span className={`status-chip ${ATTENDANCE_COLOR[a.status]}`}>{ATTENDANCE_LABEL[a.status]}</span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "grades" && (
          <div className="space-y-2">
            {data.results.length === 0 ? (
              <EmptyState icon={ClipboardList} title="لا توجد درجات" description="لم يتم رصد درجات لهذا الطالب بعد." />
            ) : (
              data.results.map((r) => {
                const p = pct(r.score, r.exam.maxScore);
                const passed = p >= 50;
                return (
                  <div key={r.id} className="rounded-xl bg-card border border-border p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="font-bold text-sm truncate">{r.exam.title}</p>
                      <span className={`status-chip ${passed ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"}`}>
                        {passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {passed ? "ناجح" : "راسب"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">الدرجة</span>
                      <span className="font-black ltr-nums">{r.score} / {r.exam.maxScore}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${passed ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${p}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 text-center ltr-nums">{p}%</p>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "homework" && (
          <div className="space-y-2">
            {data.hwStatus.length === 0 ? (
              <EmptyState icon={BookOpen} title="لا توجد واجبات" description="لم يتم إسناد واجبات لهذا الطالب بعد." />
            ) : (
              data.hwStatus.map((h) => (
                <div key={h.id} className="rounded-xl bg-card border border-border p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{h.homework.title}</p>
                    {h.homework.dueDate && <p className="text-xs text-muted-foreground ltr-nums">التسليم: {h.homework.dueDate}</p>}
                  </div>
                  <span className={`status-chip ${h.done ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                    {h.done ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {h.done ? "تم" : "لم يتم"}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        <div className="h-4" />
      </div>

      {/* QR Modal */}
      {showQR && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowQR(false)}>
          <div className="bg-card rounded-2xl p-6 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">رمز QR للطالب</h3>
              <button onClick={() => setShowQR(false)} className="text-muted-foreground text-xl">×</button>
            </div>
            {qrUrl ? (
              <div className="flex flex-col items-center gap-3">
                <img src={qrUrl} alt="QR" className="w-56 h-56 rounded-xl" />
                <p className="text-xs text-muted-foreground text-center">امسح الرمز للوصول لبوابة الطالب</p>
                <div className="flex items-center gap-2 w-full">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`بوابة ${data.name} على نُخبة: ${typeof window !== "undefined" ? window.location.origin : ""}/qr/${data.qrToken}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:opacity-90 transition"
                  >
                    <MessageCircle className="h-4 w-4" /> واتساب
                  </a>
                  <button
                    onClick={() => {
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(`${window.location.origin}/qr/${data.qrToken}`);
                        toast.success("تم نسخ الرابط.");
                      }
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-muted text-sm font-bold hover:bg-muted/70 transition"
                  >
                    <Copy className="h-4 w-4" /> نسخ
                  </button>
                </div>
                <a href={`/qr/${data.qrToken}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
                  <ExternalLink className="h-4 w-4" /> فتح البوابة
                </a>
                <button onClick={regenerateQR} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-muted text-sm font-bold hover:bg-muted/70 transition">
                  <RefreshCw className="h-4 w-4" /> توليد رمز جديد
                </button>
              </div>
            ) : (
              <LoadingState label="جاري توليد الرمز..." />
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editOpen && (
        <EditStudentModal student={data} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); load(); }} />
      )}
      {sendMsgOpen && (
        <SendMessageModal studentId={data.id} studentName={data.name} onClose={() => setSendMsgOpen(false)} onSent={() => setSendMsgOpen(false)} />
      )}
    </AppShell>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: "emerald" | "rose" | "cyan" | "violet" }) {
  const colors = {
    emerald: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
    rose: "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
    cyan: "bg-cyan-50 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400",
    violet: "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
  };
  return (
    <div className={`rounded-xl p-3 text-center ${colors[accent]}`}>
      <div className="text-lg font-black ltr-nums">{value}</div>
      <div className="text-[10px] opacity-80">{label}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: "rose" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold ${accent === "rose" ? "text-rose-600" : ""} ltr-nums`}>{value}</span>
    </div>
  );
}

function EditStudentModal({ student, onClose, onSaved }: { student: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(student.name);
  const [phone, setPhone] = useState(student.phone || "");
  const [stage, setStage] = useState(student.stage || "");
  const [code, setCode] = useState(student.code || "");
  const [groupId, setGroupId] = useState(student.group?.id || "");
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ ok: boolean; groups: Array<{ id: string; name: string }> }>("/api/groups").then((d) => {
      setGroups(d.groups || []);
    }).catch(() => {});
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      await apiFetch(`/api/students/${student.id}`, {
        method: "PATCH",
        json: { name, phone, stage, code, groupId: groupId || null },
      });
      toast.success("تم تحديث البيانات.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto scroll-area" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">تعديل بيانات الطالب</h3>
          <button onClick={onClose} className="text-muted-foreground text-xl">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold mb-1">الاسم</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring" dir="auto" />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">المجموعة</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— بدون مجموعة —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            {groupId !== (student.group?.id || "") && (
              <p className="text-[11px] text-amber-600 mt-1">سيتم نقل الطالب إلى مجموعة جديدة.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">الهاتف</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm ltr-nums" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">المرحلة</label>
            <div className="flex gap-2">
              {STAGES.map((s) => (
                <button key={s} type="button" onClick={() => setStage(s)} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${stage === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">الكود</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm" dir="auto" />
          </div>
          <button onClick={save} disabled={loading} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 disabled:opacity-60">
            {loading ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SendMessageModal({ studentId, studentName, onClose, onSent }: { studentId: string; studentName: string; onClose: () => void; onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"student" | "parent">("parent");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (title.trim().length < 3 || body.trim().length < 3) {
      toast.error("العنوان والرسالة يجب أن يكونا 3 أحرف على الأقل.");
      return;
    }
    setSending(true);
    try {
      await apiFetch("/api/notifications/send", {
        method: "POST",
        json: { title, body, audience, studentId },
      });
      toast.success("تم إرسال الرسالة بنجاح.");
      onSent();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الإرسال.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2"><Send className="h-5 w-5 text-primary" /> رسالة إلى {studentName}</h3>
          <button onClick={onClose} className="text-muted-foreground text-xl">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold mb-1">الجمهور</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAudience("parent")} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${audience === "parent" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>ولي الأمر</button>
              <button type="button" onClick={() => setAudience("student")} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${audience === "student" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>الطالب</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">العنوان</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان الرسالة" className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm" dir="auto" />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">الرسالة</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="اكتب الرسالة هنا..." rows={4} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm resize-none" dir="auto" />
          </div>
          <button onClick={send} disabled={sending} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 disabled:opacity-60">
            {sending ? "جاري الإرسال..." : "إرسال"}
          </button>
        </div>
      </div>
    </div>
  );
}
