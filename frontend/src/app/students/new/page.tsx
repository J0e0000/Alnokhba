"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AppShell, InlineLoading } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { STAGES, validatePhone, validateStage } from "@/lib/validation";

interface GroupItem {
  id: string;
  name: string;
  stage: string;
}

export default function NewStudentPage() {
  const router = useRouter();
  const params = useSearchParams();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("");
  const [groupId, setGroupId] = useState(params.get("groupId") || "");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    apiFetch<{ ok: boolean; groups: GroupItem[] }>("/api/groups").then((d) => {
      setGroups(d.groups || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (groupId) {
      const g = groups.find((x) => x.id === groupId);
      if (g && !stage) setStage(g.stage);
    }
  }, [groupId, groups, stage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 3) errs.name = "الاسم يجب أن يكون 3 أحرف على الأقل.";
    if (phone) {
      const pc = validatePhone(phone);
      if (!pc.ok) errs.phone = pc.error!;
    }
    if (stage) {
      const sc = validateStage(stage);
      if (!sc.ok) errs.stage = sc.error!;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const d = await apiFetch<{ ok: boolean; student: { id: string } }>("/api/students", {
        method: "POST",
        json: { name, phone, stage, groupId: groupId || null, code: code || null },
      });
      toast.success("تمت إضافة الطالب بنجاح.");
      router.push(`/students/${d.student.id}`);
    } catch (err: any) {
      toast.error(err.message || "تعذّر إضافة الطالب.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell back="/students" title="إضافة طالب">
      <div className="px-4 pt-4">
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
          <div>
            <label className="block text-sm font-bold mb-1.5">اسم الطالب *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اكتب الاسم الكامل"
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              dir="auto"
            />
            {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">رقم الهاتف</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01012345678"
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ltr-nums"
              dir="ltr"
            />
            {errors.phone && <p className="text-xs text-rose-600 mt-1">{errors.phone}</p>}
            <p className="text-[11px] text-muted-foreground mt-1">
              يدعم الأرقام العربية (٠١٢٣) — يتم تحويلها تلقائيًا.
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">المرحلة</label>
            <div className="flex gap-2">
              {STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStage(s)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${
                    stage === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {errors.stage && <p className="text-xs text-rose-600 mt-1">{errors.stage}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">المجموعة</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— اختر المجموعة —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">كود الطالب (اختياري)</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="مثال: N-11"
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              dir="auto"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60"
          >
            {loading ? <InlineLoading label="جاري الحفظ..." /> : "حفظ الطالب"}
          </button>
        </form>
        <div className="h-4" />
      </div>
    </AppShell>
  );
}
