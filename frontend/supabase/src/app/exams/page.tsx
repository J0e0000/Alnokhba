"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Plus,
  ClipboardList,
  ChevronLeft,
  Search,
  Users,
  Award,
  CalendarDays,
} from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { EXAM_STATUS_LABEL, formatArabicDate } from "@/lib/arabic";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface GroupItem {
  id: string;
  name: string;
  stage: string;
}
interface ExamItem {
  id: string;
  title: string;
  description: string | null;
  maxScore: number;
  passScore: number | null;
  status: string;
  lessonDate: string | null;
  publishedAt: string | null;
  group: { id: string; name: string } | null;
  resultsCount: number;
  createdAt: string;
}

type StatusKey = "all" | "draft" | "published" | "closed";

export default function ExamsPage() {
  return (
    <AppShell title="الامتحانات" subtitle="إدارة الامتحانات">
      <ExamsContent />
    </AppShell>
  );
}

function ExamsContent() {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState<string>("all");
  const [status, setStatus] = useState<StatusKey>("all");

  const loadGroups = useCallback(async () => {
    try {
      const d = await apiFetch<{ ok: boolean; groups: GroupItem[] }>("/api/groups");
      if (d.ok) setGroups(d.groups);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (groupId && groupId !== "all") params.set("groupId", groupId);
      if (status !== "all") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const d = await apiFetch<{ ok: boolean; exams: ExamItem[] }>(
        `/api/exams${params.size ? `?${params.toString()}` : ""}`
      );
      if (d.ok) setExams(d.exams);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الامتحانات.");
    } finally {
      setLoading(false);
    }
  }, [groupId, status, search]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const filtered = useMemo(() => exams, [exams]);

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Search + create */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث في الامتحانات..."
            className="h-11 pe-10"
          />
        </div>
        <Link
          href="/exams/new"
          className="tile-touch inline-flex items-center justify-center gap-1.5 px-4 rounded-2xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 active:scale-95 transition"
        >
          <Plus className="h-4 w-4" />
          إنشاء
        </Link>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2">
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-full h-11">
            <SelectValue placeholder="كل المجموعات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المجموعات</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name} · {g.stage}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusKey)}>
          <SelectTrigger className="w-full h-11">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="draft">مسودة</SelectItem>
            <SelectItem value="published">منشور</SelectItem>
            <SelectItem value="closed">مغلق</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <LoadingState label="جاري تحميل الامتحانات..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="لا توجد امتحانات"
          description="أنشئ امتحانك الأول الآن."
          action={
            <Link
              href="/exams/new"
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 active:scale-95 transition"
            >
              <Plus className="h-4 w-4" />
              إنشاء امتحان
            </Link>
          }
        />
      ) : (
        <div className="space-y-3 animate-fade-in-up">
          {filtered.map((ex) => (
            <ExamCard key={ex.id} exam={ex} />
          ))}
        </div>
      )}

      <div className="h-2" />
    </div>
  );
}

function ExamCard({ exam }: { exam: ExamItem }) {
  const statusInfo = getStatusInfo(exam.status);
  return (
    <Link
      href={`/exams/${exam.id}`}
      className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-base truncate">{exam.title}</h4>
            <span className={`status-chip ${statusInfo.cls}`}>
              {statusInfo.label}
            </span>
          </div>
          {exam.group && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {exam.group.name}
            </p>
          )}
          {exam.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {exam.description}
            </p>
          )}
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-violet-50 dark:bg-violet-950/30 py-2">
          <div className="text-base font-black text-violet-700 dark:text-violet-300 ltr-nums">
            {exam.maxScore}
          </div>
          <div className="text-[10px] text-muted-foreground">الدرجة العظمى</div>
        </div>
        <div className="rounded-xl bg-muted/60 py-2">
          <div className="text-base font-black ltr-nums">{exam.resultsCount}</div>
          <div className="text-[10px] text-muted-foreground">طالب</div>
        </div>
        <div className="rounded-xl bg-muted/60 py-2">
          <div className="text-base font-black ltr-nums">
            {exam.passScore ?? "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">النجاح</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {exam.lessonDate
            ? formatArabicDate(exam.lessonDate)
            : formatArabicDate(exam.createdAt.slice(0, 10))}
        </span>
        {exam.resultsCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Award className="h-3 w-3" />
            نتائج مسجّلة
          </span>
        )}
      </div>
    </Link>
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
