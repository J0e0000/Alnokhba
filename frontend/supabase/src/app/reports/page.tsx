"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  Award,
  Target,
  BarChart3,
  ChevronLeft,
} from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";

interface ReportData {
  ok: boolean;
  overall: {
    totalStudents: number;
    totalPresent: number;
    totalAbsent: number;
    totalLate: number;
    overallRate: number;
    atRiskCount: number;
    avgGrade: number;
  };
  distribution: { excellent: number; good: number; average: number; weak: number; failing: number };
  topPerformers: Array<{
    id: string;
    name: string;
    code: string | null;
    group: { id: string; name: string } | null;
    grades: { average: number; count: number };
    attendance: { rate: number; absent: number };
  }>;
  needsAttention: Array<{
    id: string;
    name: string;
    code: string | null;
    group: { id: string; name: string } | null;
    attendance: { present: number; absent: number; total: number; rate: number };
    grades: { average: number; count: number };
    atRisk: boolean;
  }>;
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<ReportData>("/api/reports");
      setData(d);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل التقارير.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <AppShell title="التقارير"><LoadingState label="جاري التحليل..." /></AppShell>;
  if (error || !data) return <AppShell title="التقارير"><ErrorState message={error || "خطأ"} onRetry={load} /></AppShell>;

  const { overall, distribution, topPerformers, needsAttention } = data;
  const distTotal = distribution.excellent + distribution.good + distribution.average + distribution.weak + distribution.failing;

  return (
    <AppShell title="التقارير" subtitle="نظرة عامة على الأداء">
      <div className="px-4 pt-4 space-y-5">
        {/* Overall stats */}
        <section className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Users}
            label="إجمالي الطلاب"
            value={overall.totalStudents}
            accent="navy"
          />
          <StatCard
            icon={Target}
            label="نسبة الحضور"
            value={`${overall.overallRate}%`}
            accent="emerald"
          />
          <StatCard
            icon={TrendingUp}
            label="متوسط الدرجات"
            value={`${overall.avgGrade}%`}
            accent="cyan"
          />
          <StatCard
            icon={AlertTriangle}
            label="بحاجة اهتمام"
            value={overall.atRiskCount}
            accent="rose"
          />
        </section>

        {/* Attendance breakdown */}
        <section className="rounded-2xl bg-card border border-border p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            توزيع الحضور
          </h3>
          <div className="space-y-2">
            <DistBar label="حاضر" count={overall.totalPresent} total={overall.totalPresent + overall.totalAbsent + overall.totalLate} color="bg-emerald-500" />
            <DistBar label="غائب" count={overall.totalAbsent} total={overall.totalPresent + overall.totalAbsent + overall.totalLate} color="bg-rose-500" />
            <DistBar label="متأخر" count={overall.totalLate} total={overall.totalPresent + overall.totalAbsent + overall.totalLate} color="bg-amber-500" />
          </div>
        </section>

        {/* Grade distribution */}
        {distTotal > 0 && (
          <section className="rounded-2xl bg-card border border-border p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              توزيع المستويات
            </h3>
            <div className="space-y-2">
              <DistBar label="ممتاز (85%+)" count={distribution.excellent} total={distTotal} color="bg-emerald-500" />
              <DistBar label="جيد (70-84%)" count={distribution.good} total={distTotal} color="bg-cyan-500" />
              <DistBar label="متوسط (50-69%)" count={distribution.average} total={distTotal} color="bg-amber-500" />
              <DistBar label="ضعيف (30-49%)" count={distribution.weak} total={distTotal} color="bg-orange-500" />
              <DistBar label="راسب (أقل من 30%)" count={distribution.failing} total={distTotal} color="bg-rose-500" />
            </div>
          </section>
        )}

        {/* Top performers */}
        {topPerformers.length > 0 && (
          <section>
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              الأعلى أداءً
            </h3>
            <div className="space-y-2">
              {topPerformers.map((s, i) => (
                <Link
                  key={s.id}
                  href={`/students/${s.id}`}
                  className="flex items-center gap-3 rounded-xl bg-card border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
                >
                  <div className={`grid place-items-center h-9 w-9 rounded-full font-black text-sm shrink-0 ${
                    i === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                    : i === 1 ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    : i === 2 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{s.name}</p>
                    {s.group && <p className="text-xs text-muted-foreground truncate">{s.group.name}</p>}
                  </div>
                  <div className="text-left shrink-0">
                    <div className="font-black text-sm text-emerald-600 ltr-nums">{s.grades.average}%</div>
                    <div className="text-[10px] text-muted-foreground">حضور {s.attendance.rate}%</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Needs attention */}
        {needsAttention.length > 0 && (
          <section>
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              بحاجة اهتمام ({needsAttention.length})
            </h3>
            <div className="space-y-2">
              {needsAttention.map((s) => (
                <Link
                  key={s.id}
                  href={`/students/${s.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 p-3 hover:border-rose-400 transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{s.name}</p>
                    {s.group && <p className="text-xs text-muted-foreground truncate">{s.group.name}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.attendance.absent >= 3 && (
                      <span className="status-chip bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400 text-[10px]">
                        {s.attendance.absent} غياب
                      </span>
                    )}
                    {s.grades.average < 50 && s.grades.count > 0 && (
                      <span className="status-chip bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 text-[10px]">
                        {s.grades.average}%
                      </span>
                    )}
                    <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {overall.totalStudents === 0 && (
          <EmptyState
            icon={BarChart3}
            title="لا توجد بيانات"
            description="أضف طلابًا وامتحانات لعرض التقارير والتحليلات."
          />
        )}
        <div className="h-4" />
      </div>
    </AppShell>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string | number; accent: "navy" | "emerald" | "cyan" | "rose" }) {
  const colors = {
    navy: "text-navy bg-navy/5 dark:text-gold dark:bg-navy/20",
    emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400",
    cyan: "text-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 dark:text-cyan-400",
    rose: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400",
  };
  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <div className={`grid place-items-center h-10 w-10 rounded-xl mb-2 ${colors[accent]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-black ltr-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function DistBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pctVal = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground ltr-nums">{count} ({pctVal}%)</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pctVal}%` }} />
      </div>
    </div>
  );
}
