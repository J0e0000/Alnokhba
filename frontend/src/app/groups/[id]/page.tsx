"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  Plus,
  ChevronLeft,
  CalendarDays,
  Clock,
  Pencil,
  Archive,
  ArchiveRestore,
  MoreVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  ClipboardList,
  GraduationCap,
  BookOpen,
  CheckCircle2,
  UserPlus,
  Video,
} from "lucide-react";
import {
  AppShell,
  LoadingState,
  EmptyState,
  ErrorState,
} from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { validateStage, STAGES } from "@/lib/validation";
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  formatArabicDate,
  EXAM_STATUS_LABEL,
  todayStr,
} from "@/lib/arabic";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
interface StudentRow {
  id: string;
  name: string;
  phone: string | null;
  stage: string | null;
  code: string | null;
  orderIdx: number;
  groupId: string | null;
  attendance: {
    present: number;
    absent: number;
    total: number;
    rate: number;
    warn: boolean;
  };
}

interface LessonRow {
  id: string;
  title: string;
  topic: string | null;
  lessonDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  closedAt: string | null;
  videoUrl: string | null;
  groupId: string;
}

interface ExamRow {
  id: string;
  title: string;
  description: string | null;
  maxScore: number;
  passScore: number | null;
  status: string;
  lessonDate: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface HomeworkRow {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  groupId: string;
  lessonId: string | null;
  createdAt: string;
  _count?: { status: number };
}

interface GroupDetail {
  ok: boolean;
  group: {
    id: string;
    name: string;
    stage: string;
    scheduleDays: number[];
    scheduleTime: string | null;
    archived: boolean;
    createdAt: string;
    students: StudentRow[];
    lessons: LessonRow[];
    exams: ExamRow[];
    homework: HomeworkRow[];
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell back="/groups" hideNav>
      <GroupDetailContent params={params} />
    </AppShell>
  );
}

function GroupDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>("");
  const [group, setGroup] = useState<GroupDetail["group"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<GroupDetail>(`/api/groups/${id}`);
      setGroup(data.group);
    } catch (e: any) {
      setError(e?.message || "تعذّر تحميل بيانات المجموعة.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="جاري تحميل المجموعة..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!group) return <ErrorState message="المجموعة غير موجودة." />;

  return (
    <div className="animate-fade-in-up">
      <GroupHeader group={group} onReload={load} />
      <div className="px-4 pt-2 pb-8">
        <Tabs defaultValue="students" className="w-full">
          <TabsList className="w-full h-auto flex-wrap justify-center gap-1 p-1">
            <TabsTrigger value="students" className="flex-1 min-w-[68px]">
              الطلاب
            </TabsTrigger>
            <TabsTrigger value="lessons" className="flex-1 min-w-[68px]">
              الحصص
            </TabsTrigger>
            <TabsTrigger value="exams" className="flex-1 min-w-[68px]">
              الامتحانات
            </TabsTrigger>
            <TabsTrigger value="homework" className="flex-1 min-w-[68px]">
              الواجبات
            </TabsTrigger>
            <TabsTrigger value="grades" className="flex-1 min-w-[68px]">
              الدرجات
            </TabsTrigger>
          </TabsList>

          <TabsContent value="students" className="mt-4">
            <StudentsTab group={group} onReload={load} />
          </TabsContent>
          <TabsContent value="lessons" className="mt-4">
            <LessonsTab group={group} onReload={load} />
          </TabsContent>
          <TabsContent value="exams" className="mt-4">
            <ExamsTab group={group} />
          </TabsContent>
          <TabsContent value="homework" className="mt-4">
            <HomeworkTab group={group} onReload={load} />
          </TabsContent>
          <TabsContent value="grades" className="mt-4">
            <GradesTab group={group} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
function GroupHeader({
  group,
  onReload,
}: {
  group: GroupDetail["group"];
  onReload: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <>
      <div className="brand-gradient text-white px-4 pb-4 pt-1">
        <div className="max-w-640 mx-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-extrabold leading-tight truncate">
                {group.name}
              </h1>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <span className="status-chip bg-white/15 text-white">
                  {group.stage}
                </span>
                {group.archived && (
                  <span className="status-chip bg-white/10 text-white/90 inline-flex items-center gap-1">
                    <Archive className="h-3 w-3" />
                    مؤرشفة
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="grid place-items-center h-9 w-9 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
                aria-label="تعديل"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className="grid place-items-center h-9 w-9 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
                aria-label={group.archived ? "استرجاع" : "أرشفة"}
              >
                {group.archived ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <HeaderStat
              icon={Users}
              value={group.students.length}
              label="طالب"
            />
            <HeaderStat
              icon={CalendarDays}
              value={group.lessons.length}
              label="حصة"
            />
            <HeaderStat
              icon={ClipboardList}
              value={group.exams.length}
              label="امتحان"
            />
          </div>

          <div className="mt-3 text-xs text-white/80 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <ScheduleLabel
              days={group.scheduleDays}
              time={group.scheduleTime}
            />
          </div>
        </div>
      </div>

      <EditGroupDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        group={group}
        onUpdated={() => {
          setEditOpen(false);
          toast.success("تم تحديث بيانات المجموعة.");
          onReload();
        }}
      />

      <ArchiveGroupDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        archived={group.archived}
        groupName={group.name}
        onConfirm={async () => {
          try {
            await apiFetch(`/api/groups/${group.id}`, {
              method: "DELETE",
            });
            setArchiveOpen(false);
            toast.success(
              group.archived ? "تم استرجاع المجموعة." : "تمت أرشفة المجموعة."
            );
            onReload();
          } catch (e: any) {
            toast.error(e?.message || "تعذّر تنفيذ العملية.");
          }
        }}
      />
    </>
  );
}

function HeaderStat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-xl bg-white/10 py-2 flex flex-col items-center gap-0.5">
      <Icon className="h-4 w-4 opacity-80" />
      <div className="text-lg font-black ltr-nums">{value}</div>
      <div className="text-[11px] text-white/70">{label}</div>
    </div>
  );
}

function ScheduleLabel({
  days,
  time,
}: {
  days: number[];
  time: string | null;
}) {
  if (!days.length && !time) return <span>الميعاد غير محدد</span>;
  const names = days.map((d) => WEEKDAY_NAMES[d]).join("، ");
  return (
    <span className="truncate">
      {names || "—"}
      {time && <span className="mx-1.5 ltr-nums">· {time}</span>}
    </span>
  );
}

// ─── Edit dialog ─────────────────────────────────────────────────────────────
function EditGroupDialog({
  open,
  onOpenChange,
  group,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: GroupDetail["group"];
  onUpdated: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [stageValue, setStageValue] = useState(group.stage);
  const [days, setDays] = useState<number[]>(group.scheduleDays);
  const [time, setTime] = useState(group.scheduleTime || "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(group.name);
      setStageValue(group.stage);
      setDays(group.scheduleDays);
      setTime(group.scheduleTime || "");
      setFormError(null);
    }
  }, [open, group]);

  const toggleDay = (d: number) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFormError("اسم المجموعة يجب أن يكون حرفين على الأقل.");
      return;
    }
    const stageCheck = validateStage(stageValue);
    if (!stageCheck.ok) {
      setFormError(stageCheck.error!);
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/groups/${group.id}`, {
        method: "PATCH",
        json: {
          name: trimmed,
          stage: stageValue,
          scheduleDays: days.sort((a, b) => a - b),
          scheduleTime: time.trim() || null,
        },
      });
      onUpdated();
    } catch (err: any) {
      setFormError(err?.message || "تعذّر تحديث المجموعة.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">تعديل بيانات المجموعة</DialogTitle>
          <DialogDescription className="text-right">
            عدّل الاسم والمرحلة والميعاد.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e-name">اسم المجموعة</Label>
            <Input
              id="e-name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              maxLength={80}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>المرحلة</Label>
            <Select value={stageValue} onValueChange={setStageValue}>
              <SelectTrigger className="w-full h-11">
                <SelectValue placeholder="اختر المرحلة" />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>أيام الميعاد</Label>
            <div className="grid grid-cols-4 gap-2">
              {WEEKDAY_NAMES.map((n, i) => (
                <label
                  key={i}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition select-none",
                    days.includes(i)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:border-primary/40"
                  )}
                >
                  <Checkbox
                    checked={days.includes(i)}
                    onCheckedChange={() => toggleDay(i)}
                    className={cn(
                      days.includes(i) &&
                        "border-primary-foreground/30 bg-primary-foreground/20"
                    )}
                  />
                  {WEEKDAY_SHORT[i]}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-time">وقت الميعاد</Label>
            <Input
              id="e-time"
              type="time"
              value={time}
              onChange={(ev) => setTime(ev.target.value)}
              className="h-11"
            />
          </div>

          {formError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 rounded-lg">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Archive dialog ──────────────────────────────────────────────────────────
function ArchiveGroupDialog({
  open,
  onOpenChange,
  archived,
  groupName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  archived: boolean;
  groupName: string;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-right">
            {archived ? "استرجاع المجموعة؟" : "أرشفة المجموعة؟"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-right">
            {archived
              ? `سيتم استرجاع مجموعة "${groupName}" لتظهر مرة أخرى في قائمتك.`
              : `سيتم نقل مجموعة "${groupName}" إلى الأرشيف. يمكنك استرجاعها لاحقًا، لكنها لن تظهر في القائمة الرئيسية.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={archived ? "" : "bg-amber-600 hover:bg-amber-600/90"}
          >
            {archived ? "استرجاع" : "أرشفة"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Students tab ────────────────────────────────────────────────────────────
function StudentsTab({
  group,
  onReload,
}: {
  group: GroupDetail["group"];
  onReload: () => void;
}) {
  const [reorderMode, setReorderMode] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>(group.students);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setStudents(group.students);
  }, [group.students]);

  const move = async (index: number, dir: -1 | 1) => {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= students.length) return;
    const next = [...students];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    setStudents(next);
  };

  const saveOrder = async () => {
    setReordering(true);
    try {
      const items = students.map((s, i) => ({ id: s.id, orderIdx: i }));
      await apiFetch("/api/students/reorder", {
        method: "POST",
        json: { items },
      });
      toast.success("تم حفظ الترتيب الجديد.");
      setReorderMode(false);
      onReload();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر حفظ الترتيب.");
    } finally {
      setReordering(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-sm text-muted-foreground">
          {students.length} طالب
        </h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReorderMode((v) => !v)}
            disabled={students.length < 2 || reordering}
          >
            {reorderMode ? "إلغاء الترتيب" : "إعادة الترتيب"}
          </Button>
          <Button asChild size="sm">
            <Link href={`/students/new?groupId=${group.id}`}>
              <UserPlus className="h-4 w-4" />
              إضافة طالب
            </Link>
          </Button>
        </div>
      </div>

      {reorderMode && (
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            استخدم الأسهم لتحريك الطلاب ثم احفظ.
          </p>
          <Button
            type="button"
            size="sm"
            onClick={saveOrder}
            disabled={reordering}
          >
            {reordering ? "جاري الحفظ..." : "حفظ الترتيب"}
          </Button>
        </div>
      )}

      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          title="لا يوجد طلاب بعد."
          description="أضف طلابًا لهذه المجموعة لبدء تسجيل الحضور والدرجات."
          action={
            <Button asChild className="mt-2">
              <Link href={`/students/new?groupId=${group.id}`}>
                <Plus className="h-4 w-4" />
                إضافة طالب
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {students.map((s, idx) => (
            <StudentRowCard
              key={s.id}
              student={s}
              index={idx}
              total={students.length}
              reorderMode={reorderMode}
              onMove={(dir) => move(idx, dir)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentRowCard({
  student,
  index,
  total,
  reorderMode,
  onMove,
}: {
  student: StudentRow;
  index: number;
  total: number;
  reorderMode: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const { attendance: a } = student;
  return (
    <div className="flex items-stretch gap-2 rounded-2xl bg-card border border-border p-3 hover:border-primary/30 transition">
      {reorderMode && (
        <div className="flex flex-col gap-1 justify-center">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="grid place-items-center h-7 w-7 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary transition disabled:opacity-30"
            aria-label="تحريك لأعلى"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            className="grid place-items-center h-7 w-7 rounded-lg bg-muted hover:bg-primary/10 hover:text-primary transition disabled:opacity-30"
            aria-label="تحريك لأسفل"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {reorderMode ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-muted-foreground ltr-nums">
              {index + 1}.
            </span>
            <h4 className="font-bold text-sm truncate">{student.name}</h4>
            {a.warn && (
              <span className="status-chip bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                إنذار
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            {student.code && <span className="ltr-nums">كود: {student.code}</span>}
            <span>
              حضور: {a.present}/{a.total}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              غياب: {a.absent}
            </span>
            <span className="ltr-nums">{a.rate}%</span>
          </div>
        </div>
      ) : (
        <Link
          href={`/students/${student.id}`}
          className="min-w-0 flex-1 flex items-center justify-between gap-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-sm truncate">{student.name}</h4>
              {a.warn && (
                <span className="status-chip bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  إنذار
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              {student.code && (
                <span className="ltr-nums">كود: {student.code}</span>
              )}
              <span>حضور: {a.present}/{a.total}</span>
              <span className="text-rose-600 dark:text-rose-400">
                غياب: {a.absent}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-center">
              <div
                className={cn(
                  "text-base font-black ltr-nums",
                  a.rate >= 75
                    ? "text-emerald-600 dark:text-emerald-400"
                    : a.rate >= 50
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              >
                {a.rate}%
              </div>
              <div className="text-[10px] text-muted-foreground">نسبة الحضور</div>
            </div>
            <ChevronLeft className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>
      )}
    </div>
  );
}

// ─── Lessons tab ─────────────────────────────────────────────────────────────
function LessonsTab({
  group,
  onReload,
}: {
  group: GroupDetail["group"];
  onReload: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const lessons = group.lessons;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-sm text-muted-foreground">
          {lessons.length} حصة
        </h3>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          إنشاء حصة
        </Button>
      </div>

      {lessons.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="لا توجد حصص."
          description="أنشئ حصة جديدة لهذه المجموعة لتسجيل الحضور."
          action={
            <Button className="mt-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              إنشاء حصة
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {lessons.map((l) => (
            <LessonRowCard key={l.id} lesson={l} />
          ))}
        </div>
      )}

      <CreateLessonDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groupId={group.id}
        onCreated={() => {
          setCreateOpen(false);
          toast.success("تم إنشاء الحصة بنجاح.");
          onReload();
        }}
      />
    </div>
  );
}

function LessonRowCard({ lesson }: { lesson: LessonRow }) {
  const isOpen = lesson.status === "open";
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      className="block rounded-2xl bg-card border border-border p-3 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm truncate">{lesson.title}</h4>
            {isOpen ? (
              <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                مفتوحة
              </span>
            ) : (
              <span className="status-chip bg-muted text-muted-foreground">
                مغلقة
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {formatArabicDate(lesson.lessonDate)}
          </p>
          {lesson.startTime && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className="ltr-nums">{lesson.startTime}</span>
              {lesson.endTime && (
                <span className="ltr-nums">— {lesson.endTime}</span>
              )}
            </p>
          )}
          {lesson.videoUrl && (
            <p className="text-xs text-cyan-600 dark:text-cyan-400 mt-0.5 flex items-center gap-1">
              <Video className="h-3 w-3" />
              فيديو الحصة
            </p>
          )}
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

function CreateLessonDialog({
  open,
  onOpenChange,
  groupId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDate(todayStr());
      setTime("");
      setFormError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (title.trim().length < 2) {
      setFormError("عنوان الحصة يجب أن يكون حرفين على الأقل.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/api/lessons", {
        method: "POST",
        json: {
          groupId,
          title: title.trim(),
          lessonDate: date,
          startTime: time.trim() || null,
        },
      });
      onCreated();
    } catch (err: any) {
      setFormError(err?.message || "تعذّر إنشاء الحصة.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">إنشاء حصة جديدة</DialogTitle>
          <DialogDescription className="text-right">
            سيتم تجهيز سجل حضور تلقائي لكل طلاب المجموعة.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="l-title">عنوان الحصة</Label>
            <Input
              id="l-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: مراجعة الفصل الأول"
              maxLength={120}
              className="h-11"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-date">تاريخ الحصة</Label>
            <Input
              id="l-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-time">وقت الحصة (اختياري)</Label>
            <Input
              id="l-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11"
            />
          </div>

          {formError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 rounded-lg">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "جاري الحفظ..." : "إنشاء"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Exams tab ───────────────────────────────────────────────────────────────
function ExamsTab({ group }: { group: GroupDetail["group"] }) {
  const exams = group.exams;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-sm text-muted-foreground">
          {exams.length} امتحان
        </h3>
        <Button asChild size="sm">
          <Link href={`/exams/new?groupId=${group.id}`}>
            <Plus className="h-4 w-4" />
            إنشاء امتحان
          </Link>
        </Button>
      </div>

      {exams.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="لا توجد امتحانات."
          description="أنشئ امتحانًا لهذه المجموعة وتابع درجات الطلاب."
          action={
            <Button asChild className="mt-2">
              <Link href={`/exams/new?groupId=${group.id}`}>
                <Plus className="h-4 w-4" />
                إنشاء امتحان
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {exams.map((e) => (
            <ExamRowCard key={e.id} exam={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExamRowCard({ exam }: { exam: ExamRow }) {
  const statusLabel = EXAM_STATUS_LABEL[exam.status] || exam.status;
  const statusCls = useMemo(() => {
    switch (exam.status) {
      case "published":
        return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
      case "closed":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
    }
  }, [exam.status]);

  return (
    <Link
      href={`/exams/${exam.id}`}
      className="block rounded-2xl bg-card border border-border p-3 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm truncate">{exam.title}</h4>
            <span className={cn("status-chip", statusCls)}>{statusLabel}</span>
          </div>
          {exam.lessonDate && (
            <p className="text-xs text-muted-foreground mt-1">
              {formatArabicDate(exam.lessonDate)}
            </p>
          )}
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            <span className="ltr-nums">الدرجة العظمى: {exam.maxScore}</span>
            {exam.passScore != null && (
              <span className="ltr-nums">· نجاح: {exam.passScore}</span>
            )}
          </div>
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

// ─── Homework tab ────────────────────────────────────────────────────────────
function HomeworkTab({
  group,
  onReload,
}: {
  group: GroupDetail["group"];
  onReload: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const homework = group.homework;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-sm text-muted-foreground">
          {homework.length} واجب
        </h3>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          إضافة واجب
        </Button>
      </div>

      {homework.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="لا توجد واجبات."
          description="أضف واجبًا لهذه المجموعة ليصل لطلابك."
          action={
            <Button className="mt-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              إضافة واجب
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {homework.map((h) => (
            <HomeworkRowCard
              key={h.id}
              homework={h}
              studentCount={group.students.length}
              onReload={onReload}
            />
          ))}
        </div>
      )}

      <CreateHomeworkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groupId={group.id}
        onCreated={() => {
          setCreateOpen(false);
          toast.success("تم إضافة الواجب.");
          onReload();
        }}
      />
    </div>
  );
}

function HomeworkRowCard({
  homework,
  studentCount,
  onReload,
}: {
  homework: HomeworkRow;
  studentCount: number;
  onReload: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const doneCount = homework._count?.status ?? 0;

  const handleDelete = async () => {
    try {
      await apiFetch(`/api/homework/${homework.id}`, { method: "DELETE" });
      toast.success("تم حذف الواجب.");
      setDeleteOpen(false);
      onReload();
    } catch (e: any) {
      toast.error(e?.message || "تعذّر حذف الواجب.");
    }
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-3 hover:border-primary/30 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-bold text-sm truncate">{homework.title}</h4>
          {homework.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {homework.description}
            </p>
          )}
          <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
            {homework.dueDate ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatArabicDate(homework.dueDate)}
              </span>
            ) : (
              <span>بدون موعد تسليم</span>
            )}
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              تم: {doneCount}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid place-items-center h-8 w-8 rounded-lg hover:bg-muted transition shrink-0"
              aria-label="خيارات"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              تعديل
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              حذف
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EditHomeworkDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        homework={homework}
        onUpdated={() => {
          setEditOpen(false);
          onReload();
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">
              حذف الواجب؟
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              سيتم حذف "{homework.title}" وكل سجلات تسليم الطلاب له. لا يمكن
              التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateHomeworkDialog({
  open,
  onOpenChange,
  groupId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setDueDate("");
      setFormError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (title.trim().length < 3) {
      setFormError("عنوان الواجب يجب أن يكون 3 أحرف على الأقل.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/api/homework", {
        method: "POST",
        json: {
          groupId,
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
        },
      });
      onCreated();
    } catch (err: any) {
      setFormError(err?.message || "تعذّر إضافة الواجب.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">إضافة واجب جديد</DialogTitle>
          <DialogDescription className="text-right">
            سيتم تجهيز سجل تسليم تلقائي لكل طلاب المجموعة.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="h-title">عنوان الواجب</Label>
            <Input
              id="h-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: حل تمارين الصفحة 25"
              maxLength={120}
              className="h-11"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h-desc">الوصف (اختياري)</Label>
            <Textarea
              id="h-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="تفاصيل إضافية..."
              maxLength={500}
              className="min-h-20"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h-due">آخر موعد للتسليم (اختياري)</Label>
            <Input
              id="h-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-11"
            />
          </div>

          {formError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 rounded-lg">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "جاري الحفظ..." : "إضافة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditHomeworkDialog({
  open,
  onOpenChange,
  homework,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  homework: HomeworkRow;
  onUpdated: () => void;
}) {
  const [title, setTitle] = useState(homework.title);
  const [description, setDescription] = useState(homework.description || "");
  const [dueDate, setDueDate] = useState(homework.dueDate || "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(homework.title);
      setDescription(homework.description || "");
      setDueDate(homework.dueDate || "");
      setFormError(null);
    }
  }, [open, homework]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (title.trim().length < 3) {
      setFormError("عنوان الواجب يجب أن يكون 3 أحرف على الأقل.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/homework/${homework.id}`, {
        method: "PATCH",
        json: {
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
        },
      });
      toast.success("تم تحديث الواجب.");
      onUpdated();
    } catch (err: any) {
      setFormError(err?.message || "تعذّر تحديث الواجب.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">تعديل الواجب</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="he-title">عنوان الواجب</Label>
            <Input
              id="he-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="he-desc">الوصف</Label>
            <Textarea
              id="he-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className="min-h-20"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="he-due">آخر موعد للتسليم</Label>
            <Input
              id="he-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-11"
            />
          </div>

          {formError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 rounded-lg">
              {formError}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Grades tab ──────────────────────────────────────────────────────────────
interface ExamWithResults {
  id: string;
  title: string;
  maxScore: number;
  passScore: number | null;
  status: string;
  results: Array<{
    studentId: string;
    score: number;
    status: string;
  }>;
}

function GradesTab({ group }: { group: GroupDetail["group"] }) {
  const students = group.students;
  // recent published or any recent exams (up to 5)
  const recentExams = useMemo(() => {
    return group.exams
      .slice()
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .slice(0, 5);
  }, [group.exams]);

  const [examsData, setExamsData] = useState<ExamWithResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    if (recentExams.length === 0) {
      setExamsData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        recentExams.map((ex) =>
          apiFetch<{ ok: boolean; exam: any }>(`/api/exams/${ex.id}`).catch(
            () => null
          )
        )
      );
      const mapped: ExamWithResults[] = [];
      for (const r of results) {
        if (r?.ok && r.exam) {
          mapped.push({
            id: r.exam.id,
            title: r.exam.title,
            maxScore: r.exam.maxScore,
            passScore: r.exam.passScore,
            status: r.exam.status,
            results: (r.exam.results || []).map((rr: any) => ({
              studentId: rr.studentId,
              score: rr.score,
              status: rr.status,
            })),
          });
        }
      }
      setExamsData(mapped);
    } catch (e: any) {
      setError(e?.message || "تعذّر تحميل الدرجات.");
    } finally {
      setLoading(false);
    }
  }, [recentExams]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  if (students.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="لا يوجد طلاب."
        description="أضف طلابًا لعرض درجاتهم في الامتحانات."
      />
    );
  }

  if (recentExams.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="لا توجد امتحانات."
        description="أنشئ امتحانًا لهذه المجموعة لعرض جدول الدرجات."
        action={
          <Button asChild className="mt-2">
            <Link href={`/exams/new?groupId=${group.id}`}>
              <Plus className="h-4 w-4" />
              إنشاء امتحان
            </Link>
          </Button>
        }
      />
    );
  }

  if (loading) return <LoadingState label="جاري تحميل الدرجات..." />;
  if (error) return <ErrorState message={error} onRetry={loadExams} />;

  // Compute averages and pass rate per exam
  const examStats = examsData.map((ex) => {
    const graded = ex.results.filter((r) => r.status === "graded" || r.status === "submitted");
    const scores = graded.map((r) => r.score);
    const avg = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;
    const passCount = ex.passScore != null
      ? scores.filter((s) => s >= ex.passScore!).length
      : 0;
    const passRate = scores.length
      ? Math.round((passCount / scores.length) * 100)
      : 0;
    return { avg, passRate, gradedCount: graded.length };
  });

  // Per-student average
  const studentAverages = students.map((s) => {
    const scores: number[] = [];
    for (const ex of examsData) {
      const r = ex.results.find((rr) => rr.studentId === s.id);
      if (r && (r.status === "graded" || r.status === "submitted") && ex.maxScore > 0) {
        scores.push((r.score / ex.maxScore) * 100);
      }
    }
    const avg = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
    return avg;
  });

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-sm text-muted-foreground">
        آخر {examsData.length} امتحانات — {students.length} طالب
      </h3>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto scroll-area">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky right-0 bg-card z-10 min-w-[120px] text-right">
                  الطالب
                </TableHead>
                {examsData.map((ex) => (
                  <TableHead key={ex.id} className="text-center min-w-[80px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="font-bold text-xs line-clamp-1 max-w-[100px]">
                        {ex.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground ltr-nums">
                        من {ex.maxScore}
                      </span>
                    </div>
                  </TableHead>
                ))}
                <TableHead className="text-center bg-muted/40 min-w-[70px]">
                  المتوسط
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s, idx) => (
                <TableRow key={s.id}>
                  <TableCell className="sticky right-0 bg-card z-10 text-right">
                    <div className="flex flex-col">
                      <Link
                        href={`/students/${s.id}`}
                        className="font-semibold text-sm hover:text-primary hover:underline truncate max-w-[140px]"
                      >
                        {s.name}
                      </Link>
                      {s.code && (
                        <span className="text-[10px] text-muted-foreground ltr-nums">
                          {s.code}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  {examsData.map((ex) => {
                    const r = ex.results.find((rr) => rr.studentId === s.id);
                    return (
                      <TableCell key={ex.id} className="text-center">
                        {r ? (
                          r.status === "pending" ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <ScoreCell
                              score={r.score}
                              max={ex.maxScore}
                              pass={ex.passScore}
                            />
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center bg-muted/40">
                    <span
                      className={cn(
                        "font-bold ltr-nums",
                        studentAverages[idx] >= 50
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {studentAverages[idx]}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableBody>
              <TableRow className="bg-muted/30 font-bold">
                <TableCell className="sticky right-0 bg-muted/50 z-10 text-right">
                  المتوسط
                </TableCell>
                {examStats.map((st, i) => (
                  <TableCell key={i} className="text-center">
                    <span className="ltr-nums">{st.avg || "—"}</span>
                  </TableCell>
                ))}
                <TableCell className="text-center bg-muted/50">—</TableCell>
              </TableRow>
              <TableRow className="bg-muted/30">
                <TableCell className="sticky right-0 bg-muted/50 z-10 text-right text-xs text-muted-foreground">
                  نسبة النجاح
                </TableCell>
                {examStats.map((st, i) => (
                  <TableCell key={i} className="text-center">
                    <span
                      className={cn(
                        "text-xs font-bold ltr-nums",
                        st.passRate >= 50
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {st.gradedCount > 0 ? `${st.passRate}%` : "—"}
                    </span>
                  </TableCell>
                ))}
                <TableCell className="text-center bg-muted/50">—</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground px-1">
        يمكنك تعديل الدرجات من صفحة كل امتحان.
      </p>
    </div>
  );
}

function ScoreCell({
  score,
  max,
  pass,
}: {
  score: number;
  max: number;
  pass: number | null;
}) {
  const isPass = pass != null ? score >= pass : score >= max * 0.5;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 rounded-md text-xs font-bold ltr-nums",
        isPass
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
      )}
    >
      {score}
    </span>
  );
}
