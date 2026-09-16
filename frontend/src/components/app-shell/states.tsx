import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function LoadingState({ label = "جاري التحميل..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function InlineLoading({ label = "جاري الحفظ..." }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  );
}

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 px-6 text-center", className)}>
      {Icon && (
        <div className="grid place-items-center h-16 w-16 rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-8 w-8" />
        </div>
      )}
      <div>
        <h3 className="font-bold text-base">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = "حدث خطأ", message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      <div className="grid place-items-center h-16 w-16 rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <h3 className="font-bold text-base">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto leading-relaxed">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 active:scale-95 transition"
        >
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}
