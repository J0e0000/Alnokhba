"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Users,
  CalendarDays,
  GraduationCap,
  Bell,
  ClipboardList,
  QrCode,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  AlertTriangle,
  TrendingUp,
  BookOpen,
  Video,
  BarChart3,
  Settings,
  Calendar,
} from "lucide-react";
import { AppShell, BigTile, EmptyState, LoadingState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { formatArabicDate } from "@/lib/arabic";

interface DashboardData {
  ok: boolean;
  teacher: {
    id: string;
    fullName: string;
    centerName: string | null;
    absenceThreshold: number;
  };
  today: string;
  stats: {
    groups: number;
    students: number;
    todaysLessons: number;
    exams: number;
    warnings: number;
    unreadNotifs: number;
  };
  todaysLessons: Array<{
    id: string;
    title: string;
    topic: string | null;
    startTime: string | null;
    status: string;
    group: { id: string; name: string; stage: string } | null;
    studentCount: number;
    presentCount: number;
    absentCount: number;
  }>;
  atRiskStudents: Array<{
    id: string;
    name: string;
    absent: number;
    group: { name: string } | null;
  }>;
}

export default function HomePage() {
  return (
    <AppShell showBrand>
      <DashboardContent />
    </AppShell>
  );
}

function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<DashboardData>("/api/dashboard");
      setData(d);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل لوحة التحكم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="جاري تحميل لوحة التحكم..." />;
  if (error || !data) {
    return (
      <div className="p-4">
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
          <p className="font-bold">تعذّر التحميل</p>
          <p className="text-sm mt-1">{error || "خطأ غير معروف."}</p>
        </div>
      </div>
    );
  }

  const { teacher, stats, todaysLessons, today } = data;

  // Aggregate today's attendance
  const todayPresent = todaysLessons.reduce((s, l) => s + l.presentCount, 0);
  const todayAbsent = todaysLessons.reduce((s, l) => s + l.absentCount, 0);
  const todayTotal = todaysLessons.reduce((s, l) => s + l.studentCount, 0);
  const todayRate = todayTotal ? Math.round((todayPresent / todayTotal) * 100) : 0;

  return (
    <div className="px-4 pt-4 space-y-6">
      {/* Greeting */}
      <section className="animate-fade-in-up">
        <p className="text-sm text-muted-foreground">
          {formatArabicDate(today)}
        </p>
        <h2 className="text-2xl font-black mt-1">
          أهلاً، {teacher.fullName.split(" ")[0]} 👋
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {teacher.centerName || "مركز نُخبة التعليمي"}
        </p>
      </section>

      {/* Today's summary stats */}
      {todaysLessons.length > 0 && (
        <section className="animate-fade-in-up">
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-2xl bg-card border border-border p-3 text-center">
              <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 ltr-nums">{todayPresent}</div>
              <div className="text-[10px] text-muted-foreground">حاضر</div>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 text-center">
              <div className="text-xl font-black text-rose-600 dark:text-rose-400 ltr-nums">{todayAbsent}</div>
              <div className="text-[10px] text-muted-foreground">غائب</div>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 text-center">
              <div className="text-xl font-black text-cyan-600 dark:text-cyan-400 ltr-nums">{todayTotal}</div>
              <div className="text-[10px] text-muted-foreground">إجمالي</div>
            </div>
            <div className="rounded-2xl bg-card border border-border p-3 text-center">
              <div className="text-xl font-black text-violet-600 dark:text-violet-400 ltr-nums">{todayRate}%</div>
              <div className="text-[10px] text-muted-foreground">نسبة</div>
            </div>
          </div>
        </section>
      )}

      {/* Today's lessons — primary */}
      <section className="animate-fade-in-up">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            حصص اليوم
          </h3>
          <Link
            href="/lessons"
            className="text-sm font-bold text-primary hover:underline inline-flex items-center gap-1"
          >
            الكل
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </div>

        {todaysLessons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6">
            <EmptyState
              icon={CalendarDays}
              title="لا توجد حصص اليوم"
              description="يمكنك إنشاء حصة جديدة أو تصفّح الحصص القادمة."
              action={
                <Link
                  href="/lessons"
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 active:scale-95 transition"
                >
                  <Plus className="h-4 w-4" />
                  إنشاء حصة
                </Link>
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {todaysLessons.map((l) => (
              <LessonCard key={l.id} lesson={l} />
            ))}
          </div>
        )}
      </section>

      {/* Large icon tiles grid */}
      <section className="animate-fade-in-up">
        <h3 className="font-bold text-lg mb-3">القائمة الرئيسية</h3>
        <div className="grid grid-cols-3 gap-3">
          <BigTile
            href="/groups"
            icon={Users}
            title="المجموعات"
            count={stats.groups}
            accent="navy"
          />
          <BigTile
            href="/students"
            icon={GraduationCap}
            title="الطلاب"
            count={stats.students}
            accent="gold"
          />
          <BigTile
            href="/lessons"
            icon={CalendarDays}
            title="الحصص"
            count={stats.todaysLessons}
            accent="cyan"
          />
          <BigTile
            href="/exams"
            icon={ClipboardList}
            title="الامتحانات"
            count={stats.exams}
            accent="violet"
          />
          <BigTile
            href="/grades"
            icon={BarChart3}
            title="الدرجات"
            accent="emerald"
          />
          <BigTile
            href="/reports"
            icon={TrendingUp}
            title="التقارير"
            accent="rose"
          />
          <BigTile
            href="/schedule"
            icon={Calendar}
            title="الجدول"
            accent="cyan"
          />
          <BigTile
            href="/homework"
            icon={BookOpen}
            title="الواجبات"
            accent="gold"
          />
          <BigTile
            href="/students?warn=1"
            icon={AlertTriangle}
            title="إنذارات"
            count={stats.warnings}
            accent="rose"
          />
          <BigTile
            href="/notifications"
            icon={Bell}
            title="الإشعارات"
            count={stats.unreadNotifs}
            accent="navy"
          />
        </div>
      </section>

      {/* Quick actions */}
      <section className="animate-fade-in-up">
        <h3 className="font-bold text-lg mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/lessons/scan"
            className="tile-touch rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-4 flex flex-col gap-2 hover:opacity-95 active:scale-[0.98] transition"
          >
            <QrCode className="h-7 w-7" />
            <span className="font-bold text-sm">مسح QR للحضور</span>
            <span className="text-xs opacity-80">تسجيل حضور طالب برمز QR</span>
          </Link>
          <Link
            href="/students/new"
            className="tile-touch rounded-2xl bg-card border border-border p-4 flex flex-col gap-2 hover:border-primary/40 active:scale-[0.98] transition"
          >
            <Plus className="h-7 w-7 text-primary" />
            <span className="font-bold text-sm">إضافة طالب</span>
            <span className="text-xs text-muted-foreground">طالب جديد</span>
          </Link>
          <Link
            href="/students/import"
            className="tile-touch rounded-2xl bg-card border border-border p-4 flex flex-col gap-2 hover:border-primary/40 active:scale-[0.98] transition"
          >
            <TrendingUp className="h-7 w-7 text-emerald-600" />
            <span className="font-bold text-sm">استيراد طلاب</span>
            <span className="text-xs text-muted-foreground">من ملف Excel/CSV</span>
          </Link>
          <Link
            href="/exams/new"
            className="tile-touch rounded-2xl bg-card border border-border p-4 flex flex-col gap-2 hover:border-primary/40 active:scale-[0.98] transition"
          >
            <ClipboardList className="h-7 w-7 text-violet-600" />
            <span className="font-bold text-sm">إنشاء امتحان</span>
            <span className="text-xs text-muted-foreground">امتحان جديد</span>
          </Link>
          <Link
            href="/settings"
            className="tile-touch rounded-2xl bg-card border border-border p-4 flex flex-col gap-2 hover:border-primary/40 active:scale-[0.98] transition"
          >
            <Settings className="h-7 w-7 text-cyan-600" />
            <span className="font-bold text-sm">الإعدادات</span>
            <span className="text-xs text-muted-foreground">الملف الشخصي</span>
          </Link>
        </div>
      </section>

      {/* Needs attention */}
      {data.atRiskStudents && data.atRiskStudents.length > 0 && (
        <section className="animate-fade-in-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              بحاجة اهتمام
            </h3>
            <Link
              href="/students?warn=1"
              className="text-sm font-bold text-primary hover:underline"
            >
              عرض الكل
            </Link>
          </div>
          <div className="space-y-2">
            {data.atRiskStudents.map((s) => (
              <Link
                key={s.id}
                href={`/students/${s.id}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 p-3 hover:border-rose-400 transition active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{s.name}</p>
                  {s.group && <p className="text-xs text-muted-foreground truncate">{s.group.name}</p>}
                </div>
                <span className="status-chip bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400 text-[11px] shrink-0">
                  <AlertTriangle className="h-3 w-3" />
                  {s.absent} غياب
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="h-4" />
    </div>
  );
}

function LessonCard({
  lesson,
}: {
  lesson: DashboardData["todaysLessons"][number];
}) {
  const rate = lesson.studentCount
    ? Math.round((lesson.presentCount / lesson.studentCount) * 100)
    : 0;
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-base truncate">{lesson.title}</h4>
            {lesson.status === "open" ? (
              <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                مفتوحة
              </span>
            ) : (
              <span className="status-chip bg-muted text-muted-foreground">
                مغلقة
              </span>
            )}
          </div>
          {lesson.group && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {lesson.group.name} · {lesson.group.stage}
            </p>
          )}
          {lesson.startTime && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span className="ltr-nums">{lesson.startTime}</span>
            </p>
          )}
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/60 py-2">
          <div className="text-lg font-black ltr-nums">{lesson.studentCount}</div>
          <div className="text-[11px] text-muted-foreground">طالب</div>
        </div>
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 py-2">
          <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 ltr-nums">
            {lesson.presentCount}
          </div>
          <div className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">حاضر</div>
        </div>
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 py-2">
          <div className="text-lg font-black text-rose-600 dark:text-rose-400 ltr-nums">
            {lesson.absentCount}
          </div>
          <div className="text-[11px] text-rose-700/70 dark:text-rose-400/70">غائب</div>
        </div>
      </div>

      {lesson.status === "open" && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${rate}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 text-center ltr-nums">
            نسبة الحضور: {rate}%
          </p>
        </div>
      )}
    </Link>
  );
}
