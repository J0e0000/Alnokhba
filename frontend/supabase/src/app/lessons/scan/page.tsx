"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  QrCode,
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Send,
  RotateCcw,
} from "lucide-react";
import { AppShell, LoadingState, EmptyState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { formatArabicDate } from "@/lib/arabic";
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

interface LessonItem {
  id: string;
  title: string;
  lessonDate: string;
  startTime: string | null;
  status: string;
  group: { id: string; name: string; stage: string } | null;
  studentCount: number;
  presentCount: number;
  absentCount: number;
}

interface ScanRecord {
  studentName: string;
  time: string;
  status: "success" | "error";
  message?: string;
}

export default function LessonsScanPage() {
  return (
    <AppShell back="/lessons" title="مسح QR">
      <ScanContent />
    </AppShell>
  );
}

function ScanContent() {
  const searchParams = useSearchParams();
  const preId = searchParams.get("id");

  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(preId || "");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scans, setScans] = useState<ScanRecord[]>([]);

  // camera state
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // combine today + upcoming (today takes priority)
      const todayD = await apiFetch<{ ok: boolean; lessons: LessonItem[] }>(
        "/api/lessons?today=1"
      );
      const upcomingD = await apiFetch<{ ok: boolean; lessons: LessonItem[] }>(
        "/api/lessons?upcoming=1"
      );
      const combined: LessonItem[] = [];
      const seen = new Set<string>();
      for (const l of [...(todayD.lessons || []), ...(upcomingD.lessons || [])]) {
        if (!seen.has(l.id)) {
          seen.add(l.id);
          combined.push(l);
        }
      }
      setLessons(combined);
      if (!selected && combined.length > 0) {
        setSelected(preId && combined.some((l) => l.id === preId) ? preId : combined[0].id);
      }
    } catch (e: any) {
      toast.error(e.message || "تعذّر تحميل الحصص.");
    } finally {
      setLoading(false);
    }
  }, [preId, selected]);

  useEffect(() => {
    load();
  }, [load]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setCamError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("متصفحك لا يدعم الكاميرا.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamOn(true);
    } catch (e: any) {
      setCamError(e.message || "تعذّر الوصول إلى الكاميرا.");
      setCamOn(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCamOn(false);
  };

  const playBeep = () => {
    try {
      const AudioCtx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  };

  const submit = async (tokenValue?: string) => {
    const t = (tokenValue ?? token).trim();
    if (!selected) return toast.error("اختر الحصة أولًا.");
    if (!t) return toast.error("أدخل رمز QR أو امسحه.");
    setSubmitting(true);
    try {
      const d = await apiFetch<{ ok: boolean; student?: { name: string }; error?: string }>(
        `/api/lessons/${selected}/qr-scan`,
        { method: "POST", json: { token: t } }
      );
      if (d.ok && d.student) {
        toast.success(`تم تسجيل حضور: ${d.student.name}`);
        playBeep();
        setScans((prev) => [
          {
            studentName: d.student!.name,
            time: new Date().toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            status: "success" as const,
          },
          ...prev,
        ].slice(0, 30));
        setToken("");
      } else {
        throw new Error(d.error || "تعذّر التسجيل.");
      }
    } catch (e: any) {
      const msg = e.message || "تعذّر تسجيل الحضور.";
      toast.error(msg);
      setScans((prev) => [
        {
          studentName: "—",
          time: new Date().toLocaleTimeString("ar-EG", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          status: "error" as const,
          message: msg,
        },
        ...prev,
      ].slice(0, 30));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedLesson = lessons.find((l) => l.id === selected);

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Lesson selector */}
      <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <div className="space-y-1.5">
          <Label>الحصة المختارة</Label>
          {loading ? (
            <div className="h-11 rounded-md border border-input flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
              جاري التحميل...
            </div>
          ) : lessons.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground">لا توجد حصص متاحة اليوم أو قادمة.</p>
              <Link
                href="/lessons"
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold"
              >
                عرض كل الحصص
              </Link>
            </div>
          ) : (
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full h-11">
                <SelectValue placeholder="اختر الحصة" />
              </SelectTrigger>
              <SelectContent>
                {lessons.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.title} — {formatArabicDate(l.lessonDate)}
                    {l.startTime ? ` · ${l.startTime}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {selectedLesson && (
          <div className="rounded-xl bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold">{selectedLesson.title}</span>
              {selectedLesson.status === "open" ? (
                <span className="status-chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  مفتوحة
                </span>
              ) : (
                <span className="status-chip bg-muted text-muted-foreground">
                  مغلقة
                </span>
              )}
            </div>
            {selectedLesson.group && (
              <p className="text-xs text-muted-foreground mt-1">
                {selectedLesson.group.name} · {selectedLesson.group.stage}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1 ltr-nums">
              {formatArabicDate(selectedLesson.lessonDate)}
              {selectedLesson.startTime ? ` · ${selectedLesson.startTime}` : ""}
            </p>
          </div>
        )}
      </section>

      {/* Camera preview */}
      <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-1.5">
            <Camera className="h-4 w-4 text-primary" />
            معاينة الكاميرا
          </h3>
          {camOn ? (
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-400 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 transition active:scale-95"
            >
              <CameraOff className="h-3.5 w-3.5" />
              إيقاف
            </button>
          ) : (
            <button
              type="button"
              onClick={startCamera}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition active:scale-95"
            >
              <Camera className="h-3.5 w-3.5" />
              فتح الكاميرا
            </button>
          )}
        </div>

        <div className="relative aspect-square w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-black/90 border border-border">
          {camOn ? (
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-2">
              <QrCode className="h-12 w-12" />
              <p className="text-xs text-center px-4">
                الكاميرا متوقفة. اضغط «فتح الكاميرا» أو أدخل الرمز يدويًا بالأسفل.
              </p>
            </div>
          )}
          {/* Scanner overlay frame */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-2/3 h-2/3 border-2 border-gold rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
          </div>
        </div>

        {camError && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300 px-3 py-2 text-sm">
            {camError}
          </div>
        )}
        {camOn && (
          <p className="text-xs text-muted-foreground text-center">
            وجّه الكاميرا نحو رمز QR للطالب، ثم اضغط «تم المسح» وأدخل الرمز يدويًا في الحقل بالأسفل.
          </p>
        )}
      </section>

      {/* Manual entry */}
      <section className="rounded-2xl bg-card border border-border p-4 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-1.5">
          <QrCode className="h-4 w-4 text-primary" />
          إدخال رمز QR يدويًا
        </h3>
        <div className="flex items-center gap-2">
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="الصق أو اكتب الرمز هنا..."
            className="h-11 flex-1"
            dir="ltr"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button
            type="button"
            onClick={() => submit()}
            disabled={submitting || !selected || !token.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            تسجيل
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          بعد مسح QR من الكاميرا الخارجية، انسخ الرمز هنا واضغط «تسجيل».
        </p>
      </section>

      {/* Recent scans */}
      <section className="rounded-2xl bg-card border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">آخر عمليات المسح</h3>
          {scans.length > 0 && (
            <button
              type="button"
              onClick={() => setScans([])}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              مسح السجل
            </button>
          )}
        </div>
        {scans.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="لا توجد عمليات مسح بعد"
            description="ابدأ بمسح رمز QR لأحد الطلاب."
          />
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area">
            {scans.map((s, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 p-2 rounded-xl border ${
                  s.status === "success"
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
                    : "border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20"
                }`}
              >
                {s.status === "success" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">
                    {s.status === "success" ? s.studentName : "فشل التسجيل"}
                  </p>
                  {s.message && (
                    <p className="text-[11px] text-muted-foreground truncate">{s.message}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground ltr-nums shrink-0">
                  {s.time}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="h-2" />
    </div>
  );
}
