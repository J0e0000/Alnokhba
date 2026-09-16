"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface TileProps {
  href?: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  count?: number;
  accent?: "navy" | "gold" | "cyan" | "emerald" | "rose" | "violet";
  onClick?: () => void;
  className?: string;
}

const ACCENTS: Record<NonNullable<TileProps["accent"]>, string> = {
  navy: "bg-navy/5 text-navy dark:bg-navy/20 dark:text-gold",
  gold: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

export function Tile({
  href,
  icon: Icon,
  title,
  subtitle,
  count,
  accent = "navy",
  onClick,
  className,
}: TileProps) {
  const inner = (
    <>
      <div className={cn("grid place-items-center h-12 w-12 rounded-2xl", ACCENTS[accent])}>
        <Icon className="h-6 w-6" strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0 text-right">
        <div className="font-bold text-[15px] leading-tight truncate">{title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</div>
        )}
      </div>
      {typeof count === "number" && (
        <div className="status-chip bg-primary/10 text-primary">
          {count}
        </div>
      )}
    </>
  );

  const cls = cn(
    "tile-touch w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-sm transition active:scale-[0.99] text-right",
    className
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

interface TileGridProps {
  children: React.ReactNode;
  cols?: 2 | 3;
  className?: string;
}

export function TileGrid({ children, cols = 2, className }: TileGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3",
        cols === 2 ? "grid-cols-2" : "grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
}

interface BigTileProps {
  href?: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  count?: number;
  accent?: TileProps["accent"];
  onClick?: () => void;
}

/** Square-ish large icon tile for the dashboard home grid. */
export function BigTile({
  href,
  icon: Icon,
  title,
  subtitle,
  count,
  accent = "navy",
  onClick,
}: BigTileProps) {
  const inner = (
    <div className="flex flex-col items-center justify-center gap-2 p-4 text-center h-full">
      <div className={cn("grid place-items-center h-14 w-14 rounded-2xl", ACCENTS[accent])}>
        <Icon className="h-7 w-7" strokeWidth={2.2} />
      </div>
      <div className="font-bold text-sm leading-tight">{title}</div>
      {typeof count === "number" && (
        <div className="status-chip bg-primary/10 text-primary text-[11px]">{count}</div>
      )}
      {subtitle && (
        <div className="text-[11px] text-muted-foreground leading-tight line-clamp-2">{subtitle}</div>
      )}
    </div>
  );
  const cls =
    "tile-touch rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-sm transition active:scale-[0.98] h-full block";
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
