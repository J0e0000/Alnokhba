"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { User, Phone, Building2, AlertTriangle, Save, MessageCircle, Lock, Eye, EyeOff } from "lucide-react";
import { AppShell, InlineLoading } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-client";
import { validatePhone } from "@/lib/validation";

interface Teacher {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  centerName: string | null;
  whatsappNumber: string | null;
  absenceThreshold: number;
}

export default function SettingsPage() {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [centerName, setCenterName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [absenceThreshold, setAbsenceThreshold] = useState(3);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<{ ok: boolean; teacher: Teacher }>("/api/auth/me");
      setTeacher(d.teacher);
      setFullName(d.teacher.fullName);
      setCenterName(d.teacher.centerName || "");
      setPhone(d.teacher.phone || "");
      setWhatsappNumber(d.teacher.whatsappNumber || "");
      setAbsenceThreshold(d.teacher.absenceThreshold);
    } catch (e: any) {
      toast.error(e.message || "تعذّر تحميل البيانات.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    const errs: Record<string, string> = {};
    if (fullName.trim().length < 3) errs.fullName = "الاسم يجب أن يكون 3 أحرف على الأقل.";
    if (phone) {
      const pc = validatePhone(phone);
      if (!pc.ok) errs.phone = pc.error!;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      const d = await apiFetch<{ ok: boolean; teacher: Teacher }>("/api/auth/profile", {
        method: "PATCH",
        json: { fullName, centerName, phone, whatsappNumber, absenceThreshold },
      });
      setTeacher(d.teacher);
      toast.success("تم حفظ الإعدادات بنجاح.");
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error("يرجى ملء جميع الحقول.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل.");
      return;
    }
    setChangingPassword(true);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        json: { currentPassword, newPassword },
      });
      toast.success("تم تغيير كلمة المرور بنجاح.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (e: any) {
      toast.error(e.message || "تعذّر تغيير كلمة المرور.");
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) return <AppShell title="الإعدادات"><div className="px-4 pt-4"><div className="text-center py-8 text-muted-foreground">جاري التحميل...</div></div></AppShell>;

  return (
    <AppShell title="الإعدادات" subtitle="إدارة الحساب والملف الشخصي">
      <div className="px-4 pt-4 space-y-5 max-w-md mx-auto">
        {/* Profile section */}
        <section className="rounded-2xl bg-card border border-border p-4 space-y-4">
          <h3 className="font-bold flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            الملف الشخصي
          </h3>

          <div>
            <label className="block text-sm font-bold mb-1.5">الاسم الكامل</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              dir="auto"
            />
            {errors.fullName && <p className="text-xs text-rose-600 mt-1">{errors.fullName}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">البريد الإلكتروني</label>
            <input
              type="email"
              value={teacher?.email || ""}
              disabled
              className="w-full px-4 py-3 rounded-xl bg-muted border border-input text-sm font-medium text-muted-foreground ltr-nums"
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground mt-1">لا يمكن تغيير البريد الإلكتروني.</p>
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5 flex items-center gap-1">
              <Building2 className="h-4 w-4" /> اسم المركز
            </label>
            <input
              type="text"
              value={centerName}
              onChange={(e) => setCenterName(e.target.value)}
              placeholder="مثال: مركز النخبة التعليمي"
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              dir="auto"
            />
          </div>
        </section>

        {/* Contact section */}
        <section className="rounded-2xl bg-card border border-border p-4 space-y-4">
          <h3 className="font-bold flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            معلومات التواصل
          </h3>

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
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5 flex items-center gap-1">
              <MessageCircle className="h-4 w-4 text-emerald-600" /> رقم واتساب
            </label>
            <input
              type="tel"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="201012345678"
              className="w-full px-4 py-3 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ltr-nums"
              dir="ltr"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              يظهر زر "تواصل مع المدرّس" في بوابة الطالب/ولي الأمر. الصيغة الدولية بدون +.
            </p>
          </div>
        </section>

        {/* Attendance settings */}
        <section className="rounded-2xl bg-card border border-border p-4 space-y-4">
          <h3 className="font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            إعدادات الحضور والإنذار
          </h3>

          <div>
            <label className="block text-sm font-bold mb-1.5">حد الإنذار (عدد الغيابات)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={absenceThreshold}
                onChange={(e) => setAbsenceThreshold(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <div className="grid place-items-center min-w-[3rem] h-12 rounded-xl bg-primary/10 text-primary font-black text-lg ltr-nums">
                {absenceThreshold}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
              يُرسل النظام إنذارًا تلقائيًا للطالب عند بلوغ هذا الحد من الغيابات. الافتراضي: 3.
            </p>
          </div>
        </section>

        {/* Password change section */}
        <section className="rounded-2xl bg-card border border-border p-4 space-y-4">
          <h3 className="font-bold flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            تغيير كلمة المرور
          </h3>

          <div>
            <label className="block text-sm font-bold mb-1.5">كلمة المرور الحالية</label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••"
                className="w-full px-4 py-3 pe-12 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ltr-nums"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((s) => !s)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold mb-1.5">كلمة المرور الجديدة</label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="6 أحرف على الأقل"
                className="w-full px-4 py-3 pe-12 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ltr-nums"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowNew((s) => !s)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">يجب أن تكون 6 أحرف على الأقل.</p>
          </div>

          <button
            onClick={handleChangePassword}
            disabled={changingPassword || !currentPassword || !newPassword}
            className="w-full py-3 rounded-xl bg-muted font-bold text-sm hover:bg-muted/70 active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {changingPassword ? <InlineLoading label="جاري التغيير..." /> : <><Lock className="h-4 w-4" /> تغيير كلمة المرور</>}
          </button>
        </section>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving ? <InlineLoading label="جاري الحفظ..." /> : <><Save className="h-4 w-4" /> حفظ الإعدادات</>}
        </button>

        <div className="h-4" />
      </div>
    </AppShell>
  );
}
