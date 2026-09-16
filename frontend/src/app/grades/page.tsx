"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  TrendingUp,
  Award,
  Users,
  ChevronLeft,
  BarChart3,
} from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { EXAM_STATUS_LABEL } from "@/lib/arabic";

interface GradeExam {
  id: string;
  title: string;
  maxScore: number;
  passScore: number | null;
  status: string;
  group: { id: string; name: string } | null;
  createdAt: string;
  stats: {
    total: number;
    graded: number;
    pending: number;
    average: number;
    highest: number;
    lowest: number;
    passRate: number;
  };
  results: Array<{
    studentId: string;
    studentName: string;
    score: number;
    percentage: number;
    status: string;
    passed: boolean | null;
  }>;
}

interface GroupItem {
  id: string;
  name: string;
}

export default function GradesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [exams, setExams] = useState<GradeExam[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState(params.get("groupId") || "all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const d = await apiFetch<{ ok: boolean; groups: GroupItem[] }>("/api/groups");
      setGroups(d.groups || []);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = groupFilter !== "all" ? `?groupId=${groupFilter}` : "";
      const d = await apiFetch<{ ok: boolean; exams: GradeExam[] }>(`/api/grades${q}`);
      setExams(d.exams || []);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الدرجات.");
    } finally {
      setLoading(false);
    }
  }, [groupFilter]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AppShell title="الدرجات" subtitle="نتائج الامتحانات">
      <div className="px-4 pt-4 space-y-4">
        {/* Group filter */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <Chip active={groupFilter === "all"} onClick={() => setGroupFilter("all")}>كل المجموعات</Chip>
          {groups.map((g) => (
            <Chip key={g.id} active={groupFilter === g.id} onClick={() => setGroupFilter(g.id)}>
              {g.name}
            </Chip>
          ))}
        </div>

        {loading ? (
          <LoadingState label="جاري تحميل الدرجات..." />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : exams.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="لا توجد امتحانات"
            description="أنشئ امتحانًا ورصد الدرجات لعرض النتائج هنا."
            action={
              <Link
                href="/exams/new"
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition"
              >
                إنشاء امتحان
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {exams.map((e) => (
              <ExamCard
                key={e.id}
                exam={e}
                expanded={expandedId === e.id}
                onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
              />
            ))}
          </div>
        )}
        <div className="h-4" />
      </div>
    </AppShell>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border text-muted-foreground hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

function ExamCard({ exam, expanded, onToggle }: { exam: GradeExam; expanded: boolean; onToggle: () => void }) {
  const { stats } = exam;
  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-start justify-between gap-2 text-right hover:bg-muted/30 transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-base truncate">{exam.title}</h4>
            <span className={`status-chip text-[11px] ${
              exam.status === "published"
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}>
              {EXAM_STATUS_LABEL[exam.status] || exam.status}
            </span>
          </div>
          {exam.group && (
            <p className="text-sm text-muted-foreground mt-1 truncate">{exam.group.name}</p>
          )}
        </div>
        <ChevronLeft className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform ${expanded ? "-rotate-90" : ""}`} />
      </button>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-px bg-border">
        <StatBox label="متوسط" value={stats.average} accent="cyan" />
        <StatBox label="أعلى" value={stats.highest} accent="emerald" />
        <StatBox label="أقل" value={stats.lowest} accent="rose" />
        <StatBox label="نجاح" value={`${stats.passRate}%`} accent="violet" />
      </div>

      {/* Expanded results */}
      {expanded && (
        <div className="p-4 border-t border-border space-y-2 animate-fade-in-up">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>النتائج ({stats.graded} مصحح / {stats.pending} معلّق)</span>
            <span className="ltr-nums">الحد الأقصى: {exam.maxScore}</span>
          </div>
          {exam.results.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا توجد نتائج مسجلة.</p>
          ) : (
            exam.results.map((r, i) => (
              <div
                key={r.studentId}
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl ${
                  r.status === "graded"
                    ? "bg-background"
                    : "bg-muted/40"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5 ltr-nums">{i + 1}</span>
                  <span className="text-sm font-bold truncate">{r.studentName}</span>
                </div>
                {r.status === "graded" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${r.passed ? "bg-emerald-500" : "bg-rose-500"}`}
                        style={{ width: `${r.percentage}%` }}
                      />
                    </div>
                    <span className={`font-black text-sm ltr-nums ${r.passed ? "text-emerald-600" : "text-rose-600"}`}>
                      {r.score}/{exam.maxScore}
                    </span>
                  </div>
                ) : (
                  <span className="status-chip bg-muted text-muted-foreground text-[11px]">لم يرصد</span>
                )}
              </div>
            ))
          )}
          <Link
            href={`/exams/${exam.id}`}
            className="block w-full text-center py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-bold hover:bg-primary/20 transition"
          >
            فتح تفاصل الامتحان
          </Link>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string | number; accent: "cyan" | "emerald" | "rose" | "violet" }) {
  const colors = {
    cyan: "text-cyan-600 dark:text-cyan-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
    violet: "text-violet-600 dark:text-violet-400",
  };
  return (
    <div className="bg-card p-3 text-center">
      <div className={`text-lg font-black ltr-nums ${colors[accent]}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
