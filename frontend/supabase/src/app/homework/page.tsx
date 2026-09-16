"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { BookOpen, Plus, CheckCircle2, XCircle, Clock, ChevronLeft } from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { formatArabicDate, todayStr } from "@/lib/arabic";

interface HomeworkItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  groupId: string;
  lessonId: string | null;
  createdAt: string;
  group: { id: string; name: string } | null;
  lesson: { id: string; title: string; lessonDate: string } | null;
  _count: { status: number };
}

interface GroupItem {
  id: string;
  name: string;
}

export default function HomeworkPage() {
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState("all");

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
      const d = await apiFetch<{ ok: boolean; homework: HomeworkItem[] }>(`/api/homework${q}`);
      setItems(d.homework || []);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الواجبات.");
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

  const today = todayStr();

  return (
    <AppShell title="الواجبات" subtitle="كل الواجبات">
      <div className="px-4 pt-4 space-y-4">
        {/* Filter */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <Chip active={groupFilter === "all"} onClick={() => setGroupFilter("all")}>كل المجموعات</Chip>
          {groups.map((g) => (
            <Chip key={g.id} active={groupFilter === g.id} onClick={() => setGroupFilter(g.id)}>
              {g.name}
            </Chip>
          ))}
        </div>

        {/* Create button */}
        <Link
          href="/lessons"
          className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-95 transition"
        >
          <Plus className="h-4 w-4" />
          إضافة واجب (من داخل الحصة)
        </Link>

        {/* List */}
        {loading ? (
          <LoadingState label="جاري التحميل..." />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="لا توجد واجبات"
            description="أضف واجبات من داخل صفحة الحصة."
          />
        ) : (
          <div className="space-y-3">
            {items.map((hw) => {
              const overdue = hw.dueDate && hw.dueDate < today;
              const dueToday = hw.dueDate === today;
              return (
                <Link
                  key={hw.id}
                  href={hw.lessonId ? `/lessons/${hw.lessonId}` : `/groups/${hw.groupId}`}
                  className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-sm truncate">{hw.title}</h4>
                      {hw.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{hw.description}</p>
                      )}
                      {hw.group && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{hw.group.name}</p>
                      )}
                    </div>
                    <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {hw.dueDate && (
                      <span className={`status-chip text-[11px] ${
                        overdue
                          ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400"
                          : dueToday
                          ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        <Clock className="h-3 w-3" />
                        {overdue ? "متأخر" : dueToday ? "اليوم" : "قادم"}
                        <span className="ltr-nums">· {formatArabicDate(hw.dueDate).split(" ").slice(1).join(" ")}</span>
                      </span>
                    )}
                    <span className="status-chip bg-primary/10 text-primary text-[11px]">
                      {hw._count.status} طالب
                    </span>
                  </div>
                </Link>
              );
            })}
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
