"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  useParams,
  useRouter,
} from "next/navigation";
import {
  Check,
  X,
  Clock,
  UserCheck,
  CalendarDays,
  Video,
  Plus,
  QrCode,
  Pencil,
  Lock,
  ClipboardList,
  BookOpen,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  AlarmClock,
  ShieldCheck,
  Search,
} from "lucide-react";
import { AppShell, LoadingState, ErrorState, EmptyState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_COLOR,
  formatArabicDate,
} from "@/lib/arabic";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface AttendanceRow {
  id: string;
  studentId: string;
  status: string;
  method: string;
  recordedAt: string;
}
interface StudentWithAtt {
  id: string;
  name: string;
  phone: string | null;
  code: string | null;
  orderIdx: number;
  attendance: AttendanceRow | null;
}
interface HomeworkItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  createdAt: string;
  _count?: { status: number };
  status?: { done: boolean; studentId: string }[];
}
interface GroupExam {
  id: string;
  title: string;
  status: string;
  maxScore: number;
}
interface LessonDetail {
  id: string;
  title: string;
  topic: string | null;
  lessonDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  videoUrl: string | null;
  group: { id: string; name: string; stage: string } | null;
  students: StudentWithAtt[];
  homework: HomeworkItem[];
  groupExams: GroupExam[];
}

const ATTENDANCE_ACTIONS: Array<{
  status: "present" | "absent" | "late" | "excused";
  label: string;
  icon: React.ElementType;
  cls: string;
  activeCls: string;
}> = [
  {
    status: "present",
    label: "حاضر",
    icon: Check,
    cls: "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
    activeCls: "bg-emerald-500 text-white border-emerald-500",
  },
  {
    status: "absent",
    label: "غائب",
    icon: X,
    cls: "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40",
    activeCls: "bg-rose-500 text-white border-rose-500",
  },
  {
    status: "late",
    label: "متأخر",
    icon: AlarmClock,
    cls: "border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950/40",
    activeCls: "bg-amber-500 text-white border-amber-500",
  },
  {
    status: "excused",
    label: "بعذر",
    icon: ShieldCheck,
    cls: "border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-400 dark:hover:bg-sky-950/40",
    activeCls: "bg-sky-500 text-white border-sky-500",
  },
];

export default function LessonDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [videoInput, setVideoInput] = useState("");
  const [savingVideo, setSavingVideo] = useState(false);
  const [attSearch, setAttSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<{ ok: boolean; lesson: LessonDetail; error?: string }>(
        `/api/lessons/${id}`
      );
      if (d.ok && d.lesson) {
        setLesson(d.lesson);
        setVideoInput(d.lesson.videoUrl || "");
      } else {
        setError(d.error || "الحصة غير موجودة.");
      }
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الحصة.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const setAttendance = async (studentId: string, status: string) => {
    if (!lesson || lesson.status === "closed") {
      toast.error("الحصة مغلقة. لا يمكن تعديل الحضور.");
      return;
    }
    // optimistic update
    setLesson((prev) =>
      prev
        ? {
            ...prev,
            students: prev.students.map((s) =>
              s.id === studentId
                ? {
                    ...s,
                    attendance: s.attendance
                      ? {
                          ...s.attendance,
                          status,
                          method: "manual",
                          recordedAt: new Date().toISOString(),
                        }
                      : {
                          id: "tmp",
                          studentId,
                          status,
                          method: "manual",
                          recordedAt: new Date().toISOString(),
                        },
                  }
                : s
            ),
          }
        : prev
    );
    try {
      await apiFetch(`/api/lessons/${id}/attendance`, {
        method: "POST",
        json: { studentId, status, method: "manual" },
      });
      toast.success(`تم تسجيل: ${ATTENDANCE_LABEL[status]}`);
    } catch (e: any) {
      toast.error(e.message || "فشل تحديث الحضور.");
      load(); // revert
    }
  };

  // Bulk mark all as present (quick action)
  const markAllPresent = async () => {
    if (!lesson || lesson.status === "closed") {
      toast.error("الحصة مغلقة.");
      return;
    }
    const records = lesson.students
      .filter((s) => !s.attendance || s.attendance.status !== "present")
      .map((s) => ({ studentId: s.id, status: "present", method: "manual" }));
    if (records.length === 0) {
      toast.success("جميع الطلاب حاضرون بالفعل.");
      return;
    }
    // optimistic
    setLesson((prev) =>
      prev
        ? {
            ...prev,
            students: prev.students.map((s) => ({
              ...s,
              attendance: s.attendance
                ? { ...s.attendance, status: "present", method: "manual" }
                : { id: "tmp", studentId: s.id, status: "present", method: "manual", recordedAt: new Date().toISOString() },
            })),
          }
        : prev
    );
    try {
      await apiFetch(`/api/lessons/${id}/attendance`, {
        method: "POST",
        json: { records },
      });
      toast.success(`تم تسجيل حضور ${records.length} طالب.`);
    } catch (e: any) {
      toast.error(e.message || "فشل التحديث.");
      load();
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      await apiFetch(`/api/lessons/${id}`, {
        method: "PATCH",
        json: { status: "closed" },
      });
      toast.success("تم إغلاق الحصة وتسجيل الغياب النهائي.");
      setCloseOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || "تعذّر إغلاق الحصة.");
    } finally {
      setClosing(false);
    }
  };

  const saveVideo = async () => {
    setSavingVideo(true);
    try {
      await apiFetch(`/api/lessons/${id}`, {
        method: "PATCH",
        json: { videoUrl: videoInput.trim() || null },
      });
      toast.success("تم حفظ رابط الفيديو.");
      setLesson((prev) =>
        prev ? { ...prev, videoUrl: videoInput.trim() || null } : prev
      );
    } catch (e: any) {
      toast.error(e.message || "تعذّر حفظ الفيديو.");
    } finally {
      setSavingVideo(false);
    }
  };

  if (loading) {
    return (
      <AppShell back="/lessons">
        <LoadingState label="جاري تحميل الحصة..." />
      </AppShell>
    );
  }
  if (error || !lesson) {
    return (
      <AppShell back="/lessons">
        <ErrorState message={error || "الحصة غير موجودة."} onRetry={load} />
      </AppShell>
    );
  }

  const present = lesson.students.filter(
    (s) => s.attendance?.status === "present"
  ).length;
  const absent = lesson.students.filter(
    (s) => s.attendance?.status === "absent"
  ).length;
  const late = lesson.students.filter(
    (s) => s.attendance?.status === "late"
  ).length;
  const excused = lesson.students.filter(
    (s) => s.attendance?.status === "excused"
  ).length;
  const total = lesson.students.length;
  const rate = total ? Math.round(((present + late) / total) * 100) : 0;
  const isOpen = lesson.status === "open";

  return (
    <AppShell back="/lessons">
      <div className="px-4 pt-4 space-y-5">
        {/* Header card */}
        <section className="rounded-2xl bg-card border border-border p-4 animate-fade-in-up">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-black text-lg leading-tight">{lesson.title}</h2>
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
              {lesson.group && (
                <p className="text-sm text-muted-foreground mt-1">
                  {lesson.group.name} · {lesson.group.stage}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>{formatArabicDate(lesson.lessonDate)}</span>
                {lesson.startTime && (
                  <>
                    <span className="opacity-50 mx-1">·</span>
                    <Clock className="h-3.5 w-3.5" />
                    <span className="ltr-nums">
                      {lesson.startTime}
                      {lesson.endTime ? ` — ${lesson.endTime}` : ""}
                    </span>
                  </>
                )}
              </p>
              {lesson.topic && (
                <p className="text-sm mt-2 inline-flex items-center gap-1.5 bg-muted/50 rounded-lg px-2 py-1">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  {lesson.topic}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted transition active:scale-95"
            >
              <Pencil className="h-4 w-4" />
              تعديل
            </button>
            {isOpen && (
              <button
                type="button"
                onClick={() => setCloseOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold hover:opacity-90 transition active:scale-95"
              >
                <Lock className="h-4 w-4" />
                إغلاق الحصة
              </button>
            )}
            <Link
              href={`/lessons/scan?id=${lesson.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-primary/40 text-primary text-sm font-bold hover:bg-primary/5 transition active:scale-95"
            >
              <QrCode className="h-4 w-4" />
              مسح QR
            </Link>
          </div>
        </section>

        {/* Stats bar */}
        <section className="rounded-2xl bg-card border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-primary" />
              ملخص الحضور
            </h3>
            <span className="text-xs text-muted-foreground ltr-nums">
              {rate}% حضور
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden mb-3">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${rate}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <StatBox label="حاضر" value={present} cls="text-emerald-600 dark:text-emerald-400" />
            <StatBox label="غائب" value={absent} cls="text-rose-600 dark:text-rose-400" />
            <StatBox label="متأخر" value={late} cls="text-amber-600 dark:text-amber-400" />
            <StatBox label="بعذر" value={excused} cls="text-sky-600 dark:text-sky-400" />
          </div>
          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            إجمالي الطلاب: <span className="font-bold ltr-nums">{total}</span>
          </div>
        </section>

        <Tabs defaultValue="attendance" className="w-full">
          <TabsList className="w-full grid grid-cols-4 h-10">
            <TabsTrigger value="attendance">الحضور</TabsTrigger>
            <TabsTrigger value="homework">الواجبات</TabsTrigger>
            <TabsTrigger value="video">الفيديو</TabsTrigger>
            <TabsTrigger value="exam">الامتحان</TabsTrigger>
          </TabsList>

          {/* Attendance tab */}
          <TabsContent value="attendance" className="mt-3 space-y-2">
            {total === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="لا يوجد طلاب"
                description="أضف طلابًا إلى هذه المجموعة أولًا."
              />
            ) : (
              <>
                {/* Quick actions toolbar */}
                {isOpen && (
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-muted/50 border border-border">
                    <button
                      onClick={markAllPresent}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:opacity-90 active:scale-95 transition"
                    >
                      <UserCheck className="h-4 w-4" />
                      تسجيل الكل حاضر
                    </button>
                    <Link
                      href={`/lessons/scan?id=${lesson?.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 active:scale-95 transition"
                    >
                      <QrCode className="h-4 w-4" />
                      مسح QR
                    </Link>
                  </div>
                )}
                {!isOpen && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300 px-3 py-2 text-sm">
                    الحصة مغلقة — لا يمكن تعديل الحضور.
                  </div>
                )}
                {/* Student search */}
                {lesson.students.length > 5 && (
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={attSearch}
                      onChange={(e) => setAttSearch(e.target.value)}
                      placeholder="ابحث عن طالب..."
                      className="w-full ps-10 pe-3 py-2 rounded-xl bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      dir="auto"
                    />
                  </div>
                )}
                {lesson.students
                  .filter((s) => !attSearch || s.name.includes(attSearch) || (s.code || "").includes(attSearch))
                  .map((s, idx) => (
                  <StudentAttendanceRow
                    key={s.id}
                    student={s}
                    index={idx}
                    isOpen={isOpen}
                    onSet={setAttendance}
                  />
                ))}
              </>
            )}
          </TabsContent>

          {/* Homework tab */}
          <TabsContent value="homework" className="mt-3 space-y-3">
            <HomeworkSection
              lesson={lesson}
              onChanged={load}
            />
          </TabsContent>

          {/* Video tab */}
          <TabsContent value="video" className="mt-3 space-y-3">
            <section className="rounded-2xl bg-card border border-border p-4">
              <h3 className="font-bold text-sm flex items-center gap-1.5 mb-3">
                <Video className="h-4 w-4 text-violet-600" />
                رابط فيديو الحصة
              </h3>
              <div className="space-y-2">
                <Label>رابط الفيديو (YouTube / Google Drive / أي رابط)</Label>
                <Input
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder="https://..."
                  className="h-11"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={saveVideo}
                  disabled={savingVideo}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition disabled:opacity-60"
                >
                  {savingVideo && <Loader2 className="h-4 w-4 animate-spin" />}
                  {savingVideo ? "جاري الحفظ..." : "حفظ الرابط"}
                </button>
              </div>
              {lesson.videoUrl && (
                <div className="mt-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 font-bold mb-2">
                    رابط الفيديو الحالي:
                  </p>
                  <a
                    href={lesson.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline break-all"
                    dir="ltr"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    {lesson.videoUrl}
                  </a>
                </div>
              )}
            </section>
          </TabsContent>

          {/* Exam tab */}
          <TabsContent value="exam" className="mt-3 space-y-3">
            <section className="rounded-2xl bg-card border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4 text-violet-600" />
                  امتحانات المجموعة
                </h3>
                <Link
                  href={`/exams/new?groupId=${lesson.group?.id || ""}&lessonDate=${lesson.lessonDate}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 active:scale-95 transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  إرفاق امتحان
                </Link>
              </div>
              {lesson.groupExams.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="لا توجد امتحانات"
                  description="أنشئ امتحانًا جديدًا لهذه المجموعة."
                />
              ) : (
                <div className="space-y-2">
                  {lesson.groupExams.map((ex) => (
                    <Link
                      key={ex.id}
                      href={`/exams/${ex.id}`}
                      className="block rounded-xl border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{ex.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 ltr-nums">
                            الدرجة العظمى: {ex.maxScore}
                          </p>
                        </div>
                        <ExamStatusChip status={ex.status} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>

        <div className="h-2" />
      </div>

      {/* Edit dialog */}
      <EditLessonDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lesson={lesson}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />

      {/* Close confirm dialog */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد إغلاق الحصة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إغلاق الحصة وتسجيل الغياب النهائي لجميع الطلاب الذين لم
              يُسجَّل لهم حضور. سيتم إرسال إشعارات الغياب لأولياء الأمور والتحقق
              من حدوث إنذارات. لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClose}
              disabled={closing}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {closing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {closing ? "جاري الإغلاق..." : "إغلاق نهائي"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function StatBox({
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
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function StudentAttendanceRow({
  student,
  index,
  isOpen,
  onSet,
}: {
  student: StudentWithAtt;
  index: number;
  isOpen: boolean;
  onSet: (studentId: string, status: string) => void;
}) {
  const status = student.attendance?.status;
  const isQr = student.attendance?.method === "qr";
  return (
    <div className="rounded-xl bg-card border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center h-7 w-7 rounded-full bg-muted text-muted-foreground text-xs font-bold shrink-0 ltr-nums">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">{student.name}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              {student.code && <span className="ltr-nums">#{student.code}</span>}
              {status && (
                <span
                  className={`status-chip ${ATTENDANCE_COLOR[status]} text-[10px] py-0.5`}
                >
                  {ATTENDANCE_LABEL[status]}
                </span>
              )}
              {isQr && (
                <span className="inline-flex items-center gap-1 text-[10px] text-primary font-bold">
                  <QrCode className="h-3 w-3" />
                  QR
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mt-2.5">
        {ATTENDANCE_ACTIONS.map((a) => {
          const Icon = a.icon;
          const active = status === a.status;
          return (
            <button
              key={a.status}
              type="button"
              disabled={!isOpen}
              onClick={() => onSet(student.id, a.status)}
              className={`inline-flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg border text-[11px] font-bold transition active:scale-95 disabled:opacity-50 ${
                active ? a.activeCls : a.cls
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HomeworkSection({
  lesson,
  onChanged,
}: {
  lesson: LessonDetail;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <section className="rounded-2xl bg-card border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-cyan-600" />
          واجبات المجموعة
        </h3>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 active:scale-95 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          إضافة واجب
        </button>
      </div>
      {lesson.homework.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="لا توجد واجبات"
          description="أضف واجبًا جديدًا لهذه المجموعة."
        />
      ) : (
        <div className="space-y-2">
          {lesson.homework.map((h) => (
            <HomeworkCard key={h.id} homework={h} students={lesson.students} onChanged={onChanged} />
          ))}
        </div>
      )}
      <AddHomeworkDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groupId={lesson.group?.id || ""}
        lessonId={lesson.id}
        onCreated={() => {
          setAddOpen(false);
          onChanged();
        }}
      />
    </section>
  );
}

function HomeworkCard({
  homework,
  students,
  onChanged,
}: {
  homework: HomeworkItem;
  students: StudentWithAtt[];
  onChanged: () => void;
}) {
  const [toggling, setToggling] = useState<string | null>(null);

  const toggle = async (studentId: string, done: boolean) => {
    setToggling(studentId);
    try {
      await apiFetch(`/api/homework/${homework.id}`, {
        method: "POST",
        json: { studentId, done: !done },
      });
      onChanged();
    } catch (e: any) {
      toast.error(e.message || "فشل التحديث.");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm">{homework.title}</p>
          {homework.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {homework.description}
            </p>
          )}
          {homework.dueDate && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              التسليم: {formatArabicDate(homework.dueDate)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 max-h-48 overflow-y-auto scroll-area -mx-1 px-1">
        {students.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">لا يوجد طلاب.</p>
        ) : (
          <div className="space-y-1">
            {students.map((s) => {
              const done = homework.status?.find((x) => x.studentId === s.id)?.done ?? false;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id, done)}
                  disabled={toggling === s.id}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition active:scale-[0.99]"
                >
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  {done ? (
                    <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px]">
                      <CheckCircle2 className="h-3 w-3" />
                      تم
                    </span>
                  ) : (
                    <span className="status-chip bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 text-[10px]">
                      <XCircle className="h-3 w-3" />
                      لم يتم
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AddHomeworkDialog({
  open,
  onOpenChange,
  groupId,
  lessonId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  lessonId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setDueDate("");
  };

  const submit = async () => {
    if (!groupId) return toast.error("المجموعة غير محددة.");
    if (title.trim().length < 3) return toast.error("العنوان يجب أن يكون 3 أحرف على الأقل.");
    setSaving(true);
    try {
      await apiFetch("/api/homework", {
        method: "POST",
        json: {
          title: title.trim(),
          description: description.trim() || undefined,
          groupId,
          lessonId,
          dueDate: dueDate || undefined,
        },
      });
      toast.success("تمت إضافة الواجب.");
      reset();
      onCreated();
    } catch (e: any) {
      toast.error(e.message || "تعذّر إضافة الواجب.");
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
          <DialogTitle>إضافة واجب جديد</DialogTitle>
          <DialogDescription>سيُنشأ سجل لكل طالب في المجموعة.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>عنوان الواجب *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: حل تمارين الصفحة 12"
              className="h-11"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label>الوصف (اختياري)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="تفاصيل الواجب..."
              rows={3}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label>تاريخ التسليم (اختياري)</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-11"
            />
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
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "جاري الحفظ..." : "إضافة"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditLessonDialog({
  open,
  onOpenChange,
  lesson,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lesson: LessonDetail;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [topic, setTopic] = useState(lesson.topic || "");
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl || "");
  const [startTime, setStartTime] = useState(lesson.startTime || "");
  const [endTime, setEndTime] = useState(lesson.endTime || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(lesson.title);
      setTopic(lesson.topic || "");
      setVideoUrl(lesson.videoUrl || "");
      setStartTime(lesson.startTime || "");
      setEndTime(lesson.endTime || "");
    }
  }, [open, lesson]);

  const submit = async () => {
    if (title.trim().length < 2) return toast.error("العنوان قصير جدًا.");
    setSaving(true);
    try {
      await apiFetch(`/api/lessons/${lesson.id}`, {
        method: "PATCH",
        json: {
          title: title.trim(),
          topic: topic.trim() || null,
          videoUrl: videoUrl.trim() || null,
          startTime: startTime || null,
          endTime: endTime || null,
        },
      });
      toast.success("تم حفظ التعديلات.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل بيانات الحصة</DialogTitle>
          <DialogDescription>يمكنك تعديل العنوان والموضوع والأوقات ورابط الفيديو.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>عنوان الحصة</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label>الموضوع</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="h-11"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>البداية</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>النهاية</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>رابط الفيديو</Label>
            <Input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://..."
              className="h-11"
              dir="ltr"
            />
          </div>
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-muted transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExamStatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "مسودة", cls: "bg-muted text-muted-foreground" },
    published: { label: "منشور", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
    closed: { label: "مغلق", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] || map.draft;
  return <span className={`status-chip ${m.cls}`}>{m.label}</span>;
}
