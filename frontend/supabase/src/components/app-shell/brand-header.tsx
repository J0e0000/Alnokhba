"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun, ChevronLeft, Settings, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface BrandHeaderProps {
  title?: string;
  subtitle?: string;
  back?: string;
  showBrand?: boolean;
  onLogout?: () => void;
  rightSlot?: React.ReactNode;
}

export function BrandHeader({
  title,
  subtitle,
  back,
  showBrand = false,
  onLogout,
  rightSlot,
}: BrandHeaderProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // next-themes requires a mounted check to avoid hydration mismatch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <header className="brand-gradient text-white sticky top-0 z-30">
      <div className="max-w-640 mx-auto px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {back ? (
              <button
                type="button"
                onClick={() => router.push(back)}
                className="shrink-0 -ms-1 grid place-items-center h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
                aria-label="رجوع"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            ) : null}
            {showBrand ? (
              <Link href="/" className="flex items-center gap-2 min-w-0">
                <div className="grid place-items-center h-10 w-10 rounded-xl bg-gold text-navy font-black text-xl shrink-0">
                  ن
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-lg leading-tight truncate">نُخبة</div>
                  <div className="text-[11px] text-white/70 leading-tight truncate">
                    {subtitle || "منصة إدارة الحصص"}
                  </div>
                </div>
              </Link>
            ) : (
              <div className="min-w-0">
                {title && (
                  <h1 className="font-extrabold text-lg leading-tight truncate">{title}</h1>
                )}
                {subtitle && (
                  <p className="text-[11px] text-white/70 leading-tight truncate">{subtitle}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {rightSlot}
            <Link
              href="/search"
              className="grid place-items-center h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
              aria-label="البحث"
            >
              <Search className="h-5 w-5" />
            </Link>
            <Link
              href="/settings"
              className="grid place-items-center h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
              aria-label="الإعدادات"
            >
              <Settings className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="grid place-items-center h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
              aria-label="تبديل الوضع الليلي"
            >
              {mounted && theme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>
            {onLogout ? (
              <button
                type="button"
                onClick={onLogout}
                className="grid place-items-center h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 transition active:scale-95"
                aria-label="تسجيل الخروج"
              >
                <LogOut className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
