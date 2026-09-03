import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white border border-bark-100 shadow-sm ${className}`}>{children}</div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "moss" | "clay" | "rust";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-bark-100 text-bark-600",
    moss: "bg-moss-100 text-moss-700",
    clay: "bg-clay-400/20 text-clay-600",
    rust: "bg-rust-500/15 text-rust-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="mb-4 text-bark-600/50">{icon}</div>}
      <p className="font-semibold text-moss-900">{title}</p>
      {body && <p className="text-sm text-bark-600 mt-1 max-w-xs">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PrimaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-moss-700 text-white font-medium px-4 py-2.5 text-sm hover:bg-moss-800 active:scale-[0.98] transition disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-bark-100 text-moss-900 font-medium px-4 py-2.5 text-sm hover:bg-bark-100/70 active:scale-[0.98] transition disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
