"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  GraduationCap,
  CalendarDays,
  Clock,
  Video,
  BookOpen,
  Award,
  Bell,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  QrCode,
  UserCheck,
  UserX,
  AlarmClock,
  ShieldCheck,
  Printer,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_COLOR,
  formatArabicDate,
  timeAgo,
  warningStatus,
} from "@/lib/arabic";
import { useTheme } from "next-themes";

interface PortalStudent {
  id: string;
  name: string;
  stage: string | null;
  code: string | null;
  groupName: string | null;
}
interface PortalTeacher {
  fullName: string;
  centerName: string | null;
  whatsappNumber: string | null;
}
interface PortalAttendance {
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  rate: number;
  threshold: number;
  warn: boolean;
  warning: { warn: boolean; label: string; level: string };
  recent: Array<{
    id: string;
    status: string;
    label: string;
    lessonTitle: string | null;
    lessonDate: string | null;
    method: string;
    recordedAt: string;
  }>;
}
interface PortalLesson {
  id: string;
  title: string;
  topic: string | null;
  startTime: string | null;
  status: string;
  groupName: string | null;
  videoUrl: string | null;
}
interface PortalHomework {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  done: boolean;
}
interface PortalExamResult {
  id: string;
  examTitle: string;
  score: number;
  maxScore: number;
  percentage: number;
  status: string;
  gradedAt: string | null;
}
interface PortalNotif {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
}
interface PortalVideo {
  id: string;
  title: string;
  lessonDate: string;
  url: string | null;
  topic: string | null;
}
interface PortalData {
  ok: boolean;
  error?: string;
  student: PortalStudent;
  teacher: PortalTeacher;
  attendance: PortalAttendance;
  todaysLesson: PortalLesson | null;
  homework: PortalHomework[];
  examResults: PortalExamResult[];
  notifications: PortalNotif[];
  videos: PortalVideo[];
}

export default function QrPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await apiFetch<PortalData>(`/api/qr/${token}`);
      if (d.ok) {
        setData(d);
        setError(null);
      } else {
        setError(d.error || "الرابط غير صالح.");
        setData(null);
      }
    } catch (e: any) {
      const status = (e as any)?.status;
      if (status === 404) {
        setError("الرابط غير صالح أو تم إبطاله. تواصل مع المعلم لإصدار رمز جديد.");
      } else {
        setError(e.message || "تعذّر تحميل البيانات.");
      }
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    // auto-refresh every 60s
    const t = setInterval(() => load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <PortalHeader />
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">جاري تحميل البيانات...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
            <div className="grid place-items-center h-16 w-16 rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h2 className="font-bold text-base">تعذّر فتح البوابة</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
          </div>
        ) : data ? (
          <PortalContent data={data} onRefresh={load} refreshing={refreshing} />
        ) : null}
      </main>
      <footer className="max-w-md w-full mx-auto px-4 py-4 text-center text-[11px] text-muted-foreground">
        بوابة طالب نُخبة — تحدّث تلقائي كل دقيقة
      </footer>
    </div>
  );
}

function PortalHeader() {
  return (
    <header className="brand-gradient text-white pt-[calc(env(safe-area-inset-top,0px)+16px)] pb-6 px-4 rounded-b-[1.5rem]">
      <div className="max-w-md mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center h-12 w-12 rounded-xl bg-gold text-navy font-black text-2xl shrink-0">
            ن
          </div>
          <div>
            <h1 className="font-black text-lg leading-tight">نُخبة</h1>
            <p className="text-[11px] text-white/70 leading-tight">بوابة الطالب</p>
          </div>
        </div>
        <QrCode className="h-7 w-7 text-white/70" />
      </div>
    </header>
  );
}

function PortalContent({
  data,
  onRefresh,
  refreshing,
}: {
  data: PortalData;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { student, teacher, attendance, todaysLesson, homework, examResults, notifications, videos } = data;
  const wa = teacher.whatsappNumber;

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Student card */}
      <section className="rounded-2xl bg-card border border-border p-4">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center h-14 w-14 rounded-2xl bg-primary/10 text-primary shrink-0">
            <GraduationCap className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-lg leading-tight truncate">{student.name}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
              {student.stage && <span>{student.stage}</span>}
              {student.code && (
                <span className="ltr-nums bg-muted rounded-md px-1.5 py-0.5">
                  كود: {student.code}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">المعلم</p>
            <p className="font-bold mt-0.5 truncate">{teacher.fullName}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">المركز</p>
            <p className="font-bold mt-0.5 truncate">
              {teacher.centerName || "—"}
            </p>
          </div>
        </div>
        {wa && (
          <a
            href={`https://wa.me/${wa.replace(/[^0-9]/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:opacity-90 transition active:scale-[0.99]"
          >
            <MessageCircle className="h-5 w-5" />
            تواصل مع المعلم عبر واتساب
          </a>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="mt-2 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-primary/10 text-primary font-bold text-sm hover:bg-primary/20 transition active:scale-[0.99]"
        >
          <Printer className="h-5 w-5" />
          طباعة التقرير
        </button>
      </section>

      {/* Attendance summary */}
      <section className="rounded-2xl bg-card border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-primary" />
            ملخص الحضور
          </h3>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            aria-label="تحديث"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            تحديث
          </button>
        </div>

        {attendance.warn && (
          <div className={`mb-3 rounded-xl px-3 py-2 text-sm font-bold flex items-center gap-2 ${
            attendance.warning.level === "danger"
              ? "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300"
              : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300"
          }`}>
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="flex-1">
              <p>⚠ إنذار — تجاوزت حد الغياب المسموح</p>
              <p className="text-[11px] font-medium opacity-80 mt-0.5">
                عدد الغياب: <span className="ltr-nums">{attendance.absent}</span> / الحد المسموح: <span className="ltr-nums">{attendance.threshold}</span>
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 text-center mb-3">
          <AttStatBox label="حاضر" value={attendance.present} cls="text-emerald-600 dark:text-emerald-400" />
          <AttStatBox label="غائب" value={attendance.absent} cls="text-rose-600 dark:text-rose-400" />
          <AttStatBox label="متأخر" value={attendance.late} cls="text-amber-600 dark:text-amber-400" />
          <AttStatBox label="بعذر" value={attendance.excused} cls="text-sky-600 dark:text-sky-400" />
        </div>

        <div className="h-2.5 rounded-full bg-muted overflow-hidden mb-1.5">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${attendance.rate}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground text-center ltr-nums">
          نسبة الحضور: {attendance.rate}% — إجمالي الحصص: {attendance.total}
        </p>

        {attendance.recent.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold text-muted-foreground mb-2">آخر سجلات الحضور</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-area">
              {attendance.recent.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 p-2 rounded-xl border border-border bg-background/50"
                >
                  <span className={`status-chip ${ATTENDANCE_COLOR[a.status]} text-[10px]`}>
                    {a.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">
                      {a.lessonTitle || "حصة"}
                    </p>
                    {a.lessonDate && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatArabicDate(a.lessonDate)}
                      </p>
                    )}
                  </div>
                  {a.method === "qr" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary font-bold">
                      <QrCode className="h-3 w-3" />
                      QR
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Today's lesson */}
      {todaysLesson && (
        <section className="rounded-2xl bg-card border border-border p-4">
          <h3 className="font-bold text-sm flex items-center gap-1.5 mb-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            حصة اليوم
          </h3>
          <div className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-sm">{todaysLesson.title}</p>
              {todaysLesson.status === "open" ? (
                <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  مفتوحة
                </span>
              ) : (
                <span className="status-chip bg-muted text-muted-foreground">
                  مغلقة
                </span>
              )}
            </div>
            {todaysLesson.groupName && (
              <p className="text-xs text-muted-foreground mt-1">{todaysLesson.groupName}</p>
            )}
            {todaysLesson.topic && (
              <p className="text-xs mt-1">الموضوع: {todaysLesson.topic}</p>
            )}
            {todaysLesson.startTime && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span className="ltr-nums">{todaysLesson.startTime}</span>
              </p>
            )}
            {todaysLesson.videoUrl && (
              <a
                href={todaysLesson.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
              >
                <Video className="h-4 w-4" />
                مشاهدة فيديو الحصة
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </section>
      )}

      {/* Homework */}
      <section className="rounded-2xl bg-card border border-border p-4">
        <h3 className="font-bold text-sm flex items-center gap-1.5 mb-3">
          <BookOpen className="h-4 w-4 text-cyan-600" />
          الواجبات
        </h3>
        {homework.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">لا توجد واجبات حاليًا.</p>
        ) : (
          <div className="space-y-2">
            {homework.map((h) => (
              <div key={h.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm">{h.title}</p>
                    {h.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {h.description}
                      </p>
                    )}
                    {h.dueDate && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        التسليم: {formatArabicDate(h.dueDate)}
                      </p>
                    )}
                  </div>
                  {h.done ? (
                    <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px] shrink-0">
                      <CheckCircle2 className="h-3 w-3" />
                      تم
                    </span>
                  ) : (
                    <span className="status-chip bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 text-[10px] shrink-0">
                      <XCircle className="h-3 w-3" />
                      لم يتم
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Exam results */}
      <section className="rounded-2xl bg-card border border-border p-4">
        <h3 className="font-bold text-sm flex items-center gap-1.5 mb-3">
          <Award className="h-4 w-4 text-violet-600" />
          نتائج الامتحانات
        </h3>
        {examResults.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">لا توجد نتائج بعد.</p>
        ) : (
          <div className="space-y-2">
            {examResults.map((r) => {
              const passed = r.status === "graded" && r.percentage >= 50;
              return (
                <div key={r.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate">{r.examTitle}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 ltr-nums">
                        الدرجة: {r.score} / {r.maxScore}
                      </p>
                    </div>
                    <span
                      className={`status-chip text-[10px] shrink-0 ${
                        r.status === "graded"
                          ? passed
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.status === "graded" ? (passed ? "ناجح" : "راسب") : "قيد التصحيح"}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        passed ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.min(100, r.percentage)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground text-end mt-1 ltr-nums">
                    {r.percentage}%
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Notifications */}
      <section className="rounded-2xl bg-card border border-border p-4">
        <h3 className="font-bold text-sm flex items-center gap-1.5 mb-3">
          <Bell className="h-4 w-4 text-primary" />
          الإشعارات
        </h3>
        {notifications.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">لا توجد إشعارات.</p>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="rounded-xl border border-border p-3">
                <p className="font-bold text-sm">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {n.body}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {timeAgo(n.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Videos */}
      {videos.length > 0 && (
        <section className="rounded-2xl bg-card border border-border p-4">
          <h3 className="font-bold text-sm flex items-center gap-1.5 mb-3">
            <Video className="h-4 w-4 text-violet-600" />
            فيديوهات الحصص
          </h3>
          <div className="space-y-2">
            {videos.map((v) => (
              <a
                key={v.id}
                href={v.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
              >
                <div className="flex items-center gap-2">
                  <div className="grid place-items-center h-9 w-9 rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400 shrink-0">
                    <Video className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{v.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatArabicDate(v.lessonDate)}
                    </p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AttStatBox({
  label,
  value,
  cls,
}: {
  label: string;
  value: number;
  cls: string;
}) {
  return (
    <div className="rounded-xl bg-muted/50 py-2">
      <div className={`text-xl font-black ltr-nums ${cls}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
