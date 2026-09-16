"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  GraduationCap,
  Users,
  CalendarDays,
  ClipboardList,
  ArrowLeft,
  X,
} from "lucide-react";
import { AppShell, EmptyState } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";

interface SearchResult {
  ok: boolean;
  results: {
    students: Array<{ id: string; name: string; phone: string | null; code: string | null; group: { id: string; name: string } | null }>;
    groups: Array<{ id: string; name: string; stage: string }>;
    lessons: Array<{ id: string; title: string; lessonDate: string; group: { id: string; name: string } | null }>;
    exams: Array<{ id: string; title: string; status: string; maxScore: number; group: { id: string; name: string } | null }>;
  };
}

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResult["results"] | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    if (query.trim().length < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const d = await apiFetch<SearchResult>(`/api/search?q=${encodeURIComponent(query.trim())}`);
      setData(d.results);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(search, 300);
    return () => clearTimeout(t);
  }, [search]);

  const hasResults = data && (data.students.length > 0 || data.groups.length > 0 || data.lessons.length > 0 || data.exams.length > 0);

  return (
    <AppShell title="البحث" subtitle="ابحث في كل البيانات">
      <div className="px-4 pt-4 space-y-4">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم، الهاتف، المجموعة، الحصة، الامتحان..."
            autoFocus
            className="w-full ps-11 pe-10 py-3.5 rounded-xl bg-card border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            dir="auto"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Results */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">جاري البحث...</div>
        ) : !data ? (
          <EmptyState
            icon={Search}
            title="ابحث في كل شيء"
            description="اكتب اسم طالب، رقم هاتف، اسم مجموعة، عنوان حصة، أو عنوان امتحان للعثور على ما تبحث عنه بسرعة."
          />
        ) : !hasResults ? (
          <EmptyState
            icon={Search}
            title="لا توجد نتائج"
            description={`لم نعثر على نتائج لـ "${query}"`}
          />
        ) : (
          <div className="space-y-5">
            {/* Students */}
            {data.students.length > 0 && (
              <section>
                <h3 className="font-bold text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                  <GraduationCap className="h-4 w-4" /> الطلاب ({data.students.length})
                </h3>
                <div className="space-y-2">
                  {data.students.map((s) => (
                    <Link
                      key={s.id}
                      href={`/students/${s.id}`}
                      className="block rounded-xl bg-card border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{s.name}</p>
                          {s.group && <p className="text-xs text-muted-foreground truncate">{s.group.name}</p>}
                        </div>
                        {s.code && <span className="status-chip bg-muted text-muted-foreground text-[10px]">{s.code}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Groups */}
            {data.groups.length > 0 && (
              <section>
                <h3 className="font-bold text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Users className="h-4 w-4" /> المجموعات ({data.groups.length})
                </h3>
                <div className="space-y-2">
                  {data.groups.map((g) => (
                    <Link
                      key={g.id}
                      href={`/groups/${g.id}`}
                      className="block rounded-xl bg-card border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-sm truncate">{g.name}</p>
                        <span className="status-chip bg-primary/10 text-primary text-[10px]">{g.stage}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Lessons */}
            {data.lessons.length > 0 && (
              <section>
                <h3 className="font-bold text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" /> الحصص ({data.lessons.length})
                </h3>
                <div className="space-y-2">
                  {data.lessons.map((l) => (
                    <Link
                      key={l.id}
                      href={`/lessons/${l.id}`}
                      className="block rounded-xl bg-card border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{l.title}</p>
                          {l.group && <p className="text-xs text-muted-foreground truncate">{l.group.name}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground ltr-nums">{l.lessonDate}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Exams */}
            {data.exams.length > 0 && (
              <section>
                <h3 className="font-bold text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ClipboardList className="h-4 w-4" /> الامتحانات ({data.exams.length})
                </h3>
                <div className="space-y-2">
                  {data.exams.map((e) => (
                    <Link
                      key={e.id}
                      href={`/exams/${e.id}`}
                      className="block rounded-xl bg-card border border-border p-3 hover:border-primary/40 transition active:scale-[0.99]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{e.title}</p>
                          {e.group && <p className="text-xs text-muted-foreground truncate">{e.group.name}</p>}
                        </div>
                        <span className={`status-chip text-[10px] ${
                          e.status === "published"
                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {e.status === "published" ? "منشور" : e.status === "closed" ? "مغلق" : "مسودة"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        <div className="h-4" />
      </div>
    </AppShell>
  );
}
