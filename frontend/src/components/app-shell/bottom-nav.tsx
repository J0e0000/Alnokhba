"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, CalendarDays, GraduationCap, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "الرئيسية", icon: Home },
  { href: "/groups", label: "المجموعات", icon: Users },
  { href: "/lessons", label: "الحصص", icon: CalendarDays },
  { href: "/students", label: "الطلاب", icon: GraduationCap },
  { href: "/notifications", label: "الإشعارات", icon: Bell },
];

export function BottomNav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="bottom-nav" aria-label="التنقل الرئيسي">
      <div className="bottom-nav-inner">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("bottom-nav-item", active && "active")}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
