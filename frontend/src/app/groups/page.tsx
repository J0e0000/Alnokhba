"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  Plus,
  Search,
  ChevronLeft,
  CalendarDays,
  GraduationCap,
  ClipboardList,
  Clock,
  Archive,
} from "lucide-react";
import { AppShell, LoadingState, EmptyState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { validateStage, STAGES } from "@/lib/validation";
import { WEEKDAY_NAMES, WEEKDAY_SHORT } from "@/lib/arabic";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
interface GroupListItem {
  id: string;
  name: string;
  stage: string;
  scheduleDays: number[];
  scheduleTime: string | null;
  archived: boolean;
  studentsCount: number;
  lessonsCount: number;
  examsCount: number;
  scheduleLabel: string;
}

interface GroupsResponse {
  ok: boolean;
  groups: GroupListItem[];
}

// ─── Stage filter chips ─────────────────────────────────────────────────────
const STAGE_FILTERS = [
  { value: "all", label: "الكل" },
  { value: "ابتدائي", label: "ابتدائي" },
  { value: "إعدادي", label: "إعدادي" },
  { value: "ثانوي", label: "ثانوي" },
] as const;

// ─── Page ───────────────────────────────────────────────────────────────────
export default function GroupsPage() {
  return (
    <AppShell title="المجموعات" subtitle="إدارة المجموعات">
      <GroupsContent />
    </AppShell>
  );
}

function GroupsContent() {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [day, setDay] = useState<string>("all"); // 0..6 or "all"

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (stage && stage !== "all") params.set("stage", stage);
      // archived param: 0 → active only (default)
      const qs = params.toString();
      const data = await apiFetch<GroupsResponse>(`/api/groups${qs ? `?${qs}` : ""}`);
      let list = data.groups || [];
      // client-side day filter (not a server param)
      if (day !== "all") {
        const d = Number(day);
        list = list.filter((g) => g.scheduleDays.includes(d));
      }
      setGroups(list);
    } catch (e: any) {
      setError(e?.message || "تعذّر تحميل المجموعات.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, stage, day]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="px-4 pt-4 space-y-4 animate-fade-in-up">
      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث باسم المجموعة..."
          className="pr-10 h-11 rounded-xl"
          aria-label="بحث عن مجموعة"
        />
      </div>

      {/* Stage filter chips — horizontal scrollable */}
      <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
        <div className="flex gap-2 w-max pb-1">
          {STAGE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStage(f.value)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap border transition active:scale-95",
                stage === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:border-primary/40"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day filter — secondary chips */}
      <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 w-max pb-1">
          <span className="text-xs text-muted-foreground shrink-0 ml-1 flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            بميعاد:
          </span>
          <button
            type="button"
            onClick={() => setDay("all")}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap border transition active:scale-95",
              day === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:border-primary/40"
            )}
          >
            الكل
          </button>
          {WEEKDAY_NAMES.map((name, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setDay(String(i))}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap border transition active:scale-95",
                day === String(i)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:border-primary/40"
              )}
            >
              {WEEKDAY_SHORT[i]}
            </button>
          ))}
        </div>
      </div>

      {/* Create button */}
      <Button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="w-full h-11 rounded-xl text-sm font-bold"
      >
        <Plus className="h-4 w-4" />
        إنشاء مجموعة
      </Button>

      {/* Content */}
      {loading ? (
        <LoadingState label="جاري تحميل المجموعات..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="لا توجد مجموعات حتى الآن."
          description="ابدأ بإنشاء أول مجموعة لتنظيم طلابك وحصصك."
          action={
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-2"
            >
              <Plus className="h-4 w-4" />
              إنشاء مجموعة
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground px-1">
            {groups.length} مجموعة
          </p>
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </div>
      )}

      <div className="h-4" />

      {/* Create Dialog */}
      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          toast.success("تم إنشاء المجموعة بنجاح.");
          load();
        }}
      />
    </div>
  );
}

// ─── Group card ──────────────────────────────────────────────────────────────
function GroupCard({ group }: { group: GroupListItem }) {
  return (
    <Link
      href={`/groups/${group.id}`}
      className="block rounded-2xl bg-card border border-border p-4 hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base truncate">{group.name}</h3>
            <StageBadge stage={group.stage} />
            {group.archived && (
              <span className="status-chip bg-muted text-muted-foreground inline-flex items-center gap-1">
                <Archive className="h-3 w-3" />
                مؤرشفة
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="truncate">{group.scheduleLabel}</span>
          </p>
        </div>
        <ChevronLeft className="h-5 w-5 text-muted-foreground shrink-0" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat
          icon={Users}
          value={group.studentsCount}
          label="طالب"
          color="text-primary"
        />
        <Stat
          icon={CalendarDays}
          value={group.lessonsCount}
          label="حصة"
          color="text-cyan-600 dark:text-cyan-400"
        />
        <Stat
          icon={ClipboardList}
          value={group.examsCount}
          label="امتحان"
          color="text-amber-600 dark:text-amber-400"
        />
      </div>
    </Link>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-muted/60 py-2 flex flex-col items-center gap-0.5">
      <Icon className={cn("h-4 w-4", color)} />
      <div className={cn("text-lg font-black ltr-nums", color)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const cls = useMemo(() => {
    switch (stage) {
      case "ابتدائي":
        return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400";
      case "إعدادي":
        return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
      case "ثانوي":
        return "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  }, [stage]);
  return <span className={cn("status-chip", cls)}>{stage}</span>;
}

// ─── Create group dialog ────────────────────────────────────────────────────
interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

function CreateGroupDialog({ open, onOpenChange, onCreated }: CreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [stageValue, setStageValue] = useState<string>("");
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setStageValue("");
    setDays([]);
    setTime("");
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const toggleDay = (d: number) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
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
      await apiFetch("/api/groups", {
        method: "POST",
        json: {
          name: trimmedName,
          stage: stageValue,
          scheduleDays: days.sort((a, b) => a - b),
          scheduleTime: time.trim() || null,
        },
      });
      onCreated();
    } catch (err: any) {
      setFormError(err?.message || "تعذّر إنشاء المجموعة.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">إنشاء مجموعة جديدة</DialogTitle>
          <DialogDescription className="text-right">
            أنشئ مجموعة لتنظيم الطلاب والحصص والامتحانات.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="g-name">اسم المجموعة</Label>
            <Input
              id="g-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: الصف الأول الثانوي - مجموعة أ"
              maxLength={80}
              className="h-11"
              autoFocus
            />
          </div>

          {/* Stage */}
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

          {/* Schedule days */}
          <div className="space-y-1.5">
            <Label>أيام الميعاد (اختياري)</Label>
            <div className="grid grid-cols-4 gap-2">
              {WEEKDAY_NAMES.map((name, i) => (
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

          {/* Schedule time */}
          <div className="space-y-1.5">
            <Label htmlFor="g-time">وقت الميعاد (اختياري)</Label>
            <Input
              id="g-time"
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
