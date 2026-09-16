"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  ClipboardList,
  Video,
  GraduationCap,
  Award,
  CalendarDays,
  MessageSquare,
  UserX,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { AppShell, LoadingState, ErrorState, EmptyState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { timeAgo } from "@/lib/arabic";
import { toast } from "sonner";

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  student: { id: string; name: string } | null;
}

interface NotifList {
  ok: boolean;
  notifications: NotifItem[];
  unread: number;
}

const TYPE_META: Record<
  string,
  { icon: React.ElementType; cls: string }
> = {
  absence: {
    icon: UserX,
    cls: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
  },
  warning: {
    icon: AlertTriangle,
    cls: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  },
  homework: {
    icon: ClipboardList,
    cls: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
  },
  video: {
    icon: Video,
    cls: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  },
  exam: {
    icon: GraduationCap,
    cls: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  },
  result: {
    icon: Award,
    cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  lesson: {
    icon: CalendarDays,
    cls: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  },
  message: {
    icon: MessageSquare,
    cls: "bg-muted text-muted-foreground",
  },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] || TYPE_META.message;
}

export default function NotificationsPage() {
  return (
    <AppShell title="الإشعارات">
      <NotificationsContent />
    </AppShell>
  );
}

function NotificationsContent() {
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<NotifList>("/api/notifications");
      if (d.ok) {
        setItems(d.notifications);
        setUnread(d.unread);
      }
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الإشعارات.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await apiFetch("/api/notifications", { method: "POST" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
      toast.success("تم تعليم الكل كمقروء.");
    } catch (e: any) {
      toast.error(e.message || "تعذّر التحديث.");
    } finally {
      setMarkingAll(false);
    }
  };

  const markOne = async (id: string) => {
    // optimistic
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnread((u) => Math.max(0, u - 1));
    try {
      await apiFetch(`/api/notifications/${id}`, { method: "PATCH" });
    } catch {
      // revert silently
      load();
    }
  };

  return (
    <div className="px-4 pt-4 space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {unread > 0 ? (
            <>
              لديك <span className="font-bold text-primary ltr-nums">{unread}</span> إشعار غير مقروء
            </>
          ) : (
            "كل الإشعارات مقروءة"
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition active:scale-95"
          >
            <Send className="h-4 w-4" />
            رسالة
          </button>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={markingAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-bold hover:bg-muted transition active:scale-95 disabled:opacity-60"
            >
              {markingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4" />
              )}
              تعليم الكل
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <LoadingState label="جاري تحميل الإشعارات..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="لا توجد إشعارات"
          description="ستظهر هنا الإشعارات المتعلقة بالطلاب والحضور والواجبات والامتحانات."
        />
      ) : (
        <div className="space-y-2 animate-fade-in-up">
          {items.map((n) => (
            <NotifCard key={n.id} notif={n} onMark={markOne} />
          ))}
        </div>
      )}
      <div className="h-2" />
      {sendOpen && (
        <SendMessageModal onClose={() => setSendOpen(false)} onSent={() => { setSendOpen(false); load(); }} />
      )}
    </div>
  );
}

function SendMessageModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"student" | "parent">("student");
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    apiFetch<{ ok: boolean; groups: Array<{ id: string; name: string }> }>("/api/groups").then((d) => setGroups(d.groups || [])).catch(() => {});
  }, []);

  const send = async () => {
    if (title.trim().length < 3 || body.trim().length < 3) {
      toast.error("العنوان والرسالة يجب أن يكونا 3 أحرف على الأقل.");
      return;
    }
    setSending(true);
    try {
      const d = await apiFetch<{ ok: boolean; sent: number }>("/api/notifications/send", {
        method: "POST",
        json: { title, body, audience, groupId: groupId || null },
      });
      toast.success(`تم إرسال الرسالة بنجاح (${d.sent} مستلم).`);
      onSent();
    } catch (e: any) {
      toast.error(e.message || "تعذّر الإرسال.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-5 max-w-md w-full max-h-[85vh] overflow-y-auto scroll-area" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2"><Send className="h-5 w-5 text-primary" /> إرسال رسالة</h3>
          <button onClick={onClose} className="text-muted-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold mb-1">المستلمون</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm">
              <option value="">— كل الطلاب —</option>
              {groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">الجمهور</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAudience("student")} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${audience === "student" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>الطلاب</button>
              <button type="button" onClick={() => setAudience("parent")} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${audience === "parent" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>أولياء الأمور</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">العنوان</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان الرسالة" className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm" dir="auto" />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">الرسالة</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="اكتب الرسالة هنا..." rows={4} className="w-full px-3 py-2.5 rounded-xl bg-background border border-input text-sm resize-none" dir="auto" />
          </div>
          <button onClick={send} disabled={sending} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2">
            {sending ? (<><Loader2 className="h-4 w-4 animate-spin" /> جاري الإرسال...</>) : (<><Send className="h-4 w-4" /> إرسال</>)}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotifCard({
  notif,
  onMark,
}: {
  notif: NotifItem;
  onMark: (id: string) => void;
}) {
  const meta = getTypeMeta(notif.type);
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => !notif.read && onMark(notif.id)}
      className={`w-full text-right rounded-2xl border p-4 transition active:scale-[0.99] flex items-start gap-3 ${
        notif.read
          ? "bg-card border-border"
          : "bg-primary/5 border-primary/30 dark:bg-primary/10"
      }`}
    >
      <div className={`grid place-items-center h-10 w-10 rounded-xl shrink-0 ${meta.cls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`text-sm leading-tight truncate ${!notif.read ? "font-black" : "font-bold"}`}>
            {notif.title}
          </h4>
          {!notif.read && (
            <span className="h-2 w-2 rounded-full bg-primary shrink-0 animate-pulse-soft" />
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-3">
          {notif.body}
        </p>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{timeAgo(notif.createdAt)}</span>
          {notif.student && (
            <Link
              href={`/students/${notif.student.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
            >
              {notif.student.name}
            </Link>
          )}
        </div>
      </div>
    </button>
  );
}
