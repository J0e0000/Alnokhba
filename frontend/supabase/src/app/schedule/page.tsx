"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { CalendarDays, Users, Clock, Inbox } from "lucide-react";
import { AppShell, EmptyState, LoadingState, ErrorState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";

interface ScheduleData {
  ok: boolean;
  weekdays: Array<{
    index: number;
    name: string;
    groups: Array<{
      id: string;
      name: string;
      stage: string;
      time: string | null;
      studentsCount: number;
    }>;
  }>;
  unscheduled: Array<{ id: string; name: string; stage: string; studentsCount: number }>;
}

const today = new Date().getDay();

export default function SchedulePage() {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<ScheduleData>("/api/schedule");
      setData(d);
    } catch (e: any) {
      setError(e.message || "تعذّر تحميل الجدول.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <AppShell title="الجدول الأسبوعي"><LoadingState label="جاري التحميل..." /></AppShell>;
  if (error || !data) return <AppShell title="الجدول الأسبوعي"><ErrorState message={error || "خطأ"} onRetry={load} /></AppShell>;

  const totalGroups = data.weekdays.reduce((s, d) => s + d.groups.length, 0);

  return (
    <AppShell title="الجدول الأسبوعي" subtitle={`${totalGroups} موعد`}>
      <div className="px-4 pt-4 space-y-4">
        {/* Today highlight */}
        {data.weekdays[today]?.groups.length > 0 && (
          <section className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-4">
            <h3 className="font-bold flex items-center gap-2 mb-3">
              <CalendarDays className="h-5 w-5" />
              مواعيد اليوم ({data.weekdays[today].name})
            </h3>
            <div className="space-y-2">
              {data.weekdays[today].groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="flex items-center justify-between gap-2 bg-white/10 rounded-xl p-3 hover:bg-white/20 transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{g.name}</p>
                    <div className="flex items-center gap-3 text-xs opacity-90 mt-0.5">
                      {g.time && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /><span className="ltr-nums">{g.time}</span></span>}
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{g.studentsCount}</span>
                    </div>
                  </div>
                  <span className="status-chip bg-white/20 text-[10px]">{g.stage}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Weekly grid */}
        <section className="space-y-3">
          <h3 className="font-bold text-lg">الأسبوع</h3>
          {data.weekdays.map((day) => (
            <div
              key={day.index}
              className={`rounded-2xl border overflow-hidden ${
                day.index === today
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-border bg-muted/30">
                <h4 className="font-bold text-sm flex items-center gap-2">
                  {day.index === today && <span className="h-2 w-2 rounded-full bg-primary animate-pulse-soft" />}
                  {day.name}
                </h4>
                <span className="text-xs text-muted-foreground">
                  {day.groups.length === 0 ? "لا يوجد" : `${day.groups.length} مجموعة`}
                </span>
              </div>
              {day.groups.length > 0 ? (
                <div className="divide-y divide-border">
                  {day.groups.map((g) => (
                    <Link
                      key={g.id}
                      href={`/groups/${g.id}`}
                      className="flex items-center justify-between gap-2 p-3 hover:bg-muted/30 transition active:scale-[0.99]"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{g.name}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          {g.time && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /><span className="ltr-nums">{g.time}</span></span>}
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{g.studentsCount} طالب</span>
                        </div>
                      </div>
                      <span className="status-chip bg-primary/10 text-primary text-[10px]">{g.stage}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-muted-foreground">—</div>
              )}
            </div>
          ))}
        </section>

        {/* Unscheduled groups */}
        {data.unscheduled.length > 0 && (
          <section>
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-amber-500" />
              مجموعات بدون موعد
            </h3>
            <div className="space-y-2">
              {data.unscheduled.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="block rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3 hover:border-amber-400 transition active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{g.name}</p>
                      <p className="text-xs text-muted-foreground">{g.studentsCount} طالب</p>
                    </div>
                    <span className="status-chip bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px]">
                      {g.stage}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
        <div className="h-4" />
      </div>
    </AppShell>
  );
}
