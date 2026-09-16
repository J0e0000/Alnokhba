"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BrandHeader } from "./brand-header";
import { BottomNav } from "./bottom-nav";
import { LoadingState } from "./states";
import { apiFetch } from "@/lib/api-client";

interface TeacherInfo {
  id: string;
  email: string;
  fullName: string;
  centerName: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  absenceThreshold: number;
  subscriptionStatus: string;
}

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  back?: string;
  showBrand?: boolean;
  rightSlot?: React.ReactNode;
  hideNav?: boolean;
}

export function AppShell({
  children,
  title,
  subtitle,
  back,
  showBrand,
  rightSlot,
  hideNav,
}: AppShellProps) {
  const router = useRouter();
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const data = await apiFetch<any>("/api/auth/me");
      if (data.ok && data.teacher) {
        setTeacher(data.teacher);
      } else {
        router.replace("/login");
        return;
      }
    } catch {
      router.replace("/login");
      return;
    } finally {
      setLoading(false);
      setAuthChecked(true);
    }
  }, [router]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.replace("/login");
  }, [router]);

  if (loading || !authChecked) {
    return (
      <div className="app-shell">
        <LoadingState label="جاري التحميل..." />
      </div>
    );
  }
  if (!teacher) return null;

  return (
    <div className="app-shell">
      <BrandHeader
        title={title}
        subtitle={subtitle ?? (showBrand ? undefined : teacher.centerName || teacher.fullName)}
        back={back}
        showBrand={showBrand}
        onLogout={!back ? handleLogout : undefined}
        rightSlot={rightSlot}
      />
      <main className="app-main">{children}</main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
