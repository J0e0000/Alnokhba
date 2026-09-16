"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Upload,
  AlertTriangle,
  GraduationCap,
  Phone,
  ChevronLeft,
  Filter,
} from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { STAGES } from "@/lib/validation";
import { cn } from "@/lib/utils";

interface StudentItem {
  id: string;
  name: string;
  phone: string | null;
  stage: string | null;
  code: string | null;
  orderIdx: number;
  group: { id: string; name: string; stage: string } | null;
  attendance: { present: number; absent: number; total: number; rate: number; warn: boolean };
}

interface GroupItem {
  id: string;
  name: string;
  stage: string;
}

export default function StudentsPage() {
  const router = useRouter();
  const params = useSearchParams();

  const [students, setStudents] = useState<StudentItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(params.get("search") || "");
  const [stage, setStage] = useState(params.get("stage") || "all");
  const [groupId, setGroupId] = useState(params.get("groupId") || "all");
  const [warnOnly, setWarnOnly] = useState(params.get("warn") === "1");

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
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (stage !== "all") q.set("stage", stage);
      if (groupId !== "all") q.set("groupId", groupId);
      if (warnOnly) q.set("warn", "1");
      const d = await apiFetch<{ ok: boolean; students: StudentItem[] }>(
        `/api/students?${q.toString()}`
      );
      setStudents(d.students || []);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الطلاب.");
    } finally {
      setLoading(false);
    }
  }, [search, stage, groupId, warnOnly]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AppShell title="الطلاب" subtitle="إدارة الطلاب">
      <div className="px-4 pt-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="ابحث بالاسم أو الهاتف أو الكود..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full ps-11 pe-4 py-3 rounded-xl bg-card border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            dir="auto"
          />
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <Chip active={stage === "all"} onClick={() => setStage("all")}>الكل</Chip>
            {STAGES.map((s) => (
              <Chip key={s} active={stage === s} onClick={() => setStage(s)}>{s}</Chip>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <Chip active={groupId === "all"} onClick={() => setGroupId("all")}>كل المجموعات</Chip>
            {groups.map((g) => (
              <Chip key={g.id} active={groupId === g.id} onClick={() => setGroupId(g.id)}>
                {g.name}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Chip active={warnOnly} onClick={() => setWarnOnly((w) => !w)} accent="rose">
              <AlertTriangle className="h-3.5 w-3.5" />
              إنذارات فقط
            </Chip>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/students/new"
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-95 transition"
          >
            <Plus className="h-4 w-4" />
            إضافة طالب
          </Link>
          <Link
            href="/students/import"
            className="flex items-center justify-center gap-2 py-3 rounded-xl bg-card border border-border font-bold text-sm hover:border-primary/40 active:scale-95 transition"
          >
            <Upload className="h-4 w-4" />
            استيراد طلاب
          </Link>
        </div>

        {/* List */}
        {loading ? (
          <LoadingState label="جاري تحميل الطلاب..." />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : students.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="لا يوجد طلاب"
            description="ابدأ بإضافة طالب جديد أو استيراد قائمة طلاب من ملف."
            action={
              <Link
                href="/students/new"
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 active:scale-95 transition"
              >
                <Plus className="h-4 w-4" />
                إضافة طالب
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {students.length} طالب
            </p>
            {students.map((s) => (
              <StudentCard key={s.id} student={s} />
            ))}
          </div>
        )}
        <div className="h-4" />
      </div>
    </AppShell>
  );
}

function Chip({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: "rose";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border transition",
        active
          ? accent === "rose"
            ? "bg-rose-500 text-white border-rose-500"
            : "bg-primary text-primary-foreground border-primary"
          : "bg-card text-muted-foreground border-border hover:border-primary/40"
      )}
    >
      {children}
    </button>
  );
}

function StudentCard({ student }: { student: StudentItem }) {
  const { present, absent, total, rate, warn } = student.attendance;
  return (
    <Link
      href={`/students/${student.id}`}
      className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-base truncate">{student.name}</h4>
            {student.code && (
              <span className="status-chip bg-muted text-muted-foreground text-[11px]">
                {student.code}
              </span>
            )}
            {warn && (
              <span className="status-chip bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
                <AlertTriangle className="h-3 w-3" />
                إنذار
              </span>
            )}
          </div>
          {student.group && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {student.group.name}
            </p>
          )}
          {student.phone && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Phone className="h-3 w-3" />
              <span className="ltr-nums">{student.phone}</span>
            </p>
          )}
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>
      {total > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg bg-muted/60 py-1.5">
            <div className="text-sm font-black ltr-nums">{present}</div>
            <div className="text-[10px] text-muted-foreground">حاضر</div>
          </div>
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 py-1.5">
            <div className="text-sm font-black text-rose-600 dark:text-rose-400 ltr-nums">{absent}</div>
            <div className="text-[10px] text-rose-700/70 dark:text-rose-400/70">غياب</div>
          </div>
          <div className="rounded-lg bg-muted/60 py-1.5">
            <div className="text-sm font-black ltr-nums">{total}</div>
            <div className="text-[10px] text-muted-foreground">إجمالي</div>
          </div>
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 py-1.5">
            <div className="text-sm font-black text-emerald-600 dark:text-emerald-400 ltr-nums">{rate}%</div>
            <div className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70">نسبة</div>
          </div>
        </div>
      )}
    </Link>
  );
}
