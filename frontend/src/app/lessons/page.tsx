"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Plus,
  CalendarDays,
  Clock,
  Users,
  ChevronLeft,
  QrCode,
  Loader2,
  Search,
  CircleDot,
} from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { formatArabicDate, todayStr } from "@/lib/arabic";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface GroupItem {
  id: string;
  name: string;
  stage: string;
}
interface LessonItem {
  id: string;
  title: string;
  topic: string | null;
  lessonDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  videoUrl: string | null;
  group: { id: string; name: string; stage: string } | null;
  studentCount: number;
  presentCount: number;
  absentCount: number;
}

type TabKey = "today" | "upcoming" | "all";

export default function LessonsPage() {
  return (
    <AppShell title="الحصص" subtitle="إدارة الحصص">
      <LessonsContent />
    </AppShell>
  );
}

function LessonsContent() {
  const [tab, setTab] = useState<TabKey>("today");
  const [groupId, setGroupId] = useState<string>("all");
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      const d = await apiFetch<{ ok: boolean; groups: GroupItem[] }>("/api/groups");
      if (d.ok) setGroups(d.groups);
    } catch {}
  }, []);

  const loadLessons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tab === "today") params.set("today", "1");
      else if (tab === "upcoming") params.set("upcoming", "1");
      if (groupId && groupId !== "all") params.set("groupId", groupId);
      const d = await apiFetch<{ ok: boolean; lessons: LessonItem[] }>(
        `/api/lessons${params.size ? `?${params.toString()}` : ""}`
      );
      if (d.ok) setLessons(d.lessons);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الحصص.");
    } finally {
      setLoading(false);
    }
  }, [tab, groupId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    loadLessons();
  }, [loadLessons]);

  const filtered = useMemo(() => {
    return lessons;
  }, [lessons]);

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Segmented control */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-muted/60">
        <SegBtn active={tab === "today"} onClick={() => setTab("today")}>
          حصص اليوم
        </SegBtn>
        <SegBtn active={tab === "upcoming"} onClick={() => setTab("upcoming")}>
          القادمة
        </SegBtn>
        <SegBtn active={tab === "all"} onClick={() => setTab("all")}>
          الكل
        </SegBtn>
      </div>

      {/* Group filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
        <Chip active={groupId === "all"} onClick={() => setGroupId("all")}>
          الكل
        </Chip>
        {groups.map((g) => (
          <Chip key={g.id} active={groupId === g.id} onClick={() => setGroupId(g.id)}>
            {g.name}
          </Chip>
        ))}
      </div>

      {/* Top actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex-1 tile-touch inline-flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.99] transition"
        >
          <Plus className="h-5 w-5" />
          إنشاء حصة
        </button>
        <Link
          href="/lessons/scan"
          className="tile-touch inline-flex items-center justify-center gap-2 px-4 rounded-2xl bg-card border border-border font-bold text-sm hover:border-primary/40 active:scale-[0.99] transition"
        >
          <QrCode className="h-5 w-5 text-primary" />
          مسح QR
        </Link>
      </div>

      {/* List */}
      {loading ? (
        <LoadingState label="جاري تحميل الحصص..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadLessons} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={tab === "today" ? "لا توجد حصص اليوم" : "لا توجد حصص"}
          description="يمكنك إنشاء حصة جديدة أو تغيير الفلتر."
          action={
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 active:scale-95 transition"
            >
              <Plus className="h-4 w-4" />
              إنشاء حصة
            </button>
          }
        />
      ) : (
        <div className="space-y-3 animate-fade-in-up">
          {filtered.map((l) => (
            <LessonCard key={l.id} lesson={l} />
          ))}
        </div>
      )}

      <CreateLessonDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groups={groups}
        onCreated={() => {
          setCreateOpen(false);
          loadLessons();
        }}
      />

      <div className="h-2" />
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 rounded-xl text-sm font-bold transition active:scale-95 ${
        active
          ? "bg-card shadow-sm text-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-bold border transition active:scale-95 ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border text-muted-foreground hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

function LessonCard({ lesson }: { lesson: LessonItem }) {
  const isOpen = lesson.status === "open";
  const rate = lesson.studentCount
    ? Math.round((lesson.presentCount / lesson.studentCount) * 100)
    : 0;
  const isToday = lesson.lessonDate === todayStr();
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-base truncate">{lesson.title}</h4>
            {isOpen ? (
              <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                <CircleDot className="h-3 w-3" />
                مفتوحة
              </span>
            ) : (
              <span className="status-chip bg-muted text-muted-foreground">مغلقة</span>
            )}
          </div>
          {lesson.group && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {lesson.group.name} · {lesson.group.stage}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{formatArabicDate(lesson.lessonDate)}</span>
            {lesson.startTime && (
              <>
                <span className="mx-1 opacity-50">·</span>
                <Clock className="h-3.5 w-3.5" />
                <span className="ltr-nums">{lesson.startTime}</span>
                {lesson.endTime && (
                  <span className="ltr-nums">— {lesson.endTime}</span>
                )}
              </>
            )}
          </p>
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

      {isOpen && (
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

      <div className="mt-3 flex items-center justify-end gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition ${
            isOpen
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {isOpen ? "فتح الحصة" : "عرض الحصة"}
          <ChevronLeft className="h-4 w-4" />
        </span>
      </div>
      {isToday && (
        <div className="mt-2 text-[11px] text-primary font-bold">حصة اليوم</div>
      )}
    </Link>
  );
}

function CreateLessonDialog({
  open,
  onOpenChange,
  groups,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: GroupItem[];
  onCreated: () => void;
}) {
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setGroupId("");
    setTitle("");
    setTopic("");
    setDate(todayStr());
    setStartTime("");
    setEndTime("");
  };

  const submit = async () => {
    if (!groupId) return toast.error("اختر المجموعة");
    if (title.trim().length < 2) return toast.error("عنوان الحصة يجب أن يكون حرفين على الأقل.");
    if (!date) return toast.error("التاريخ مطلوب.");
    setSaving(true);
    try {
      await apiFetch("/api/lessons", {
        method: "POST",
        json: {
          groupId,
          title: title.trim(),
          topic: topic.trim() || undefined,
          lessonDate: date,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        },
      });
      toast.success("تم إنشاء الحصة بنجاح");
      reset();
      onCreated();
    } catch (e: any) {
      toast.error(e.message || "تعذّر إنشاء الحصة.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إنشاء حصة جديدة</DialogTitle>
          <DialogDescription>املأ البيانات لإنشاء حصة للمجموعة.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto scroll-area px-1">
          <div className="space-y-1.5">
            <Label>المجموعة *</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-full h-11">
                <SelectValue placeholder="اختر المجموعة" />
              </SelectTrigger>
              <SelectContent>
                {groups.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    لا توجد مجموعات. أنشئ مجموعة أولًا.
                  </div>
                ) : (
                  groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} · {g.stage}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>عنوان الحصة *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: شرح الفصل الأول"
              className="h-11"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label>الموضوع (اختياري)</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="مثال: الجبر — المعادلات"
              className="h-11"
              maxLength={120}
            />
          </div>

          <div className="space-y-1.5">
            <Label>التاريخ *</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>وقت البداية</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>وقت النهاية</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-muted transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || groups.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "جاري الإنشاء..." : "إنشاء"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
