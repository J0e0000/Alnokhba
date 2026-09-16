"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, ArrowLeft, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { validateEmail } from "@/lib/validation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const [signupMode, setSignupMode] = useState(false);
  const [fullName, setFullName] = useState("");
  const [centerName, setCenterName] = useState("");

  // Note: we intentionally do NOT call /api/auth/me on mount to avoid an
  // extra route compile in memory-constrained dev environments. The user
  // will be redirected to / if they're already logged in via the AppShell
  // gate on the dashboard route.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) return setError(emailCheck.error!);
    if (!password) return setError("كلمة المرور مطلوبة.");
    setLoading(true);
    try {
      if (signupMode) {
        if (fullName.trim().length < 3) {
          setError("الاسم يجب أن يكون 3 أحرف على الأقل.");
          setLoading(false);
          return;
        }
        await apiFetch("/api/auth/signup", {
          method: "POST",
          json: { email, password, fullName, centerName },
        });
      } else {
        await apiFetch("/api/auth/login", {
          method: "POST",
          json: { email, password },
        });
      }
      router.replace("/");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "تعذّر تسجيل الدخول.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailCheck = validateEmail(forgotEmail);
    if (!emailCheck.ok) return setError(emailCheck.error!);
    setForgotLoading(true);
    try {
      await apiFetch("/api/auth/forgot", {
        method: "POST",
        json: { email: forgotEmail },
      });
      setForgotSent(true);
    } catch (err: any) {
      setError(err.message || "تعذّر إرسال الطلب.");
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="brand-gradient text-white pt-[calc(env(safe-area-inset-top,0px)+24px)] pb-12 px-6 rounded-b-[2rem]">
        <div className="flex flex-col items-center gap-3">
          <div className="grid place-items-center h-16 w-16 rounded-2xl bg-gold text-navy font-black text-3xl shadow-lg">
            ن
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-black">نُخبة</h1>
            <p className="text-white/70 text-sm mt-1">منصة إدارة الحصص والطلاب</p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 -mt-6">
        <div className="bg-card rounded-2xl shadow-xl border border-border p-6 max-w-md mx-auto">
          {forgotMode ? (
            forgotSent ? (
              <div className="text-center py-6">
                <div className="grid place-items-center h-14 w-14 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 mb-3">
                  <Mail className="h-7 w-7" />
                </div>
                <h2 className="font-bold text-lg">تحقّق من بريدك</h2>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  إذا كان البريد مسجلاً لدينا، سيصلك رابط إعادة تعيين كلمة المرور خلال دقائق.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false);
                    setForgotSent(false);
                    setForgotEmail("");
                  }}
                  className="mt-5 w-full py-3 rounded-xl border border-border font-bold text-sm hover:bg-muted transition active:scale-[0.99]"
                >
                  العودة لتسجيل الدخول
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <h2 className="font-bold text-lg">نسيت كلمة المرور؟</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين.
                  </p>
                </div>
                <Field
                  icon={<Mail className="h-5 w-5" />}
                  type="email"
                  placeholder="البريد الإلكتروني"
                  value={forgotEmail}
                  onChange={setForgotEmail}
                  autoComplete="email"
                />
                {error && <ErrorBanner message={error} />}
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60"
                >
                  {forgotLoading ? "جاري الإرسال..." : "إرسال رابط الاستعادة"}
                </button>
                <button
                  type="button"
                  onClick={() => setForgotMode(false)}
                  className="w-full py-2 text-sm text-muted-foreground font-medium hover:text-foreground transition inline-flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="h-4 w-4" /> العودة لتسجيل الدخول
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <h2 className="font-bold text-xl">
                  {signupMode ? "إنشاء حساب جديد" : "تسجيل الدخول"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {signupMode
                    ? "ابدأ تجربتك المجانية في نُخبة الآن."
                    : "أهلاً بعودتك! سجّل دخولك للمتابعة."}
                </p>
              </div>

              {signupMode && (
                <Field
                  icon={<UserPlus className="h-5 w-5" />}
                  type="text"
                  placeholder="الاسم الكامل"
                  value={fullName}
                  onChange={setFullName}
                  autoComplete="name"
                />
              )}
              {signupMode && (
                <Field
                  icon={<span className="text-sm">🎓</span>}
                  type="text"
                  placeholder="اسم المركز (اختياري)"
                  value={centerName}
                  onChange={setCenterName}
                />
              )}

              <Field
                icon={<Mail className="h-5 w-5" />}
                type="email"
                placeholder="البريد الإلكتروني"
                value={email}
                onChange={setEmail}
                autoComplete="email"
              />
              <div className="relative">
                <Field
                  icon={<Lock className="h-5 w-5" />}
                  type={showPass ? "text" : "password"}
                  placeholder="كلمة المرور"
                  value={password}
                  onChange={setPassword}
                  autoComplete={signupMode ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                  aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>

              {error && <ErrorBanner message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.99] transition disabled:opacity-60"
              >
                {loading
                  ? signupMode
                    ? "جاري إنشاء الحساب..."
                    : "جاري تسجيل الدخول..."
                  : signupMode
                  ? "إنشاء الحساب"
                  : "دخول"}
              </button>

              {!signupMode && (
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(true);
                    setForgotEmail(email);
                    setError(null);
                  }}
                  className="w-full py-1 text-sm text-muted-foreground font-medium hover:text-primary transition"
                >
                  نسيت كلمة المرور؟
                </button>
              )}

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setSignupMode((s) => !s);
                    setError(null);
                  }}
                  className="text-sm font-bold text-primary hover:underline"
                >
                  {signupMode
                    ? "لديك حساب بالفعل؟ تسجيل الدخول"
                    : "ليس لديك حساب؟ أنشئ حساباً جديداً"}
                </button>
              </div>

              <div className="mt-4 p-3 rounded-xl bg-muted/60 border border-border text-center">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  حساب تجريبي:
                  <br />
                  <span className="font-bold ltr-nums inline-block mt-1">
                    teacher@nokhba.demo
                  </span>
                  <br />
                  <span className="font-bold ltr-nums">كلمة المرور: 123456</span>
                </p>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({
  icon,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <div className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground grid place-items-center w-5">
        {icon}
      </div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full ps-11 pe-4 py-3.5 rounded-xl bg-background border border-input text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition placeholder:text-muted-foreground/70"
        dir="auto"
      />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0 mt-0.5" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
      </svg>
      <p className="text-sm font-medium leading-relaxed">{message}</p>
    </div>
  );
}
