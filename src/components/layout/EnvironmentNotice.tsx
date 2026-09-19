import type { ReactNode } from "react";

type Tone = "info" | "danger" | "warning";

const styles: Record<Tone, { frame: string; icon: string; action: string; symbol: string }> = {
  info: {
    frame: "border-l-sky-400 border-b-sky-900/60 bg-sky-950/75 text-sky-100",
    icon: "bg-sky-400/15 text-sky-300",
    action: "text-sky-200 hover:text-white hover:bg-sky-400/15",
    symbol: "✓",
  },
  danger: {
    frame: "border-l-rose-400 border-b-rose-900/60 bg-rose-950/75 text-rose-100",
    icon: "bg-rose-400/15 text-rose-300",
    action: "text-rose-200 hover:text-white hover:bg-rose-400/15",
    symbol: "!",
  },
  warning: {
    frame: "border-l-amber-400 border-b-amber-900/60 bg-amber-950/65 text-amber-100",
    icon: "bg-amber-400/15 text-amber-300",
    action: "text-amber-200 hover:text-white hover:bg-amber-400/15",
    symbol: "i",
  },
};

export default function EnvironmentNotice({
  tone, title, children, action, onAction, onDismiss,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
  action?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  const style = styles[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"}
      className={`shrink-0 flex items-start gap-3 border-l-[3px] border-b px-4 py-2.5 ${style.frame}`}>
      <span aria-hidden="true" className={`mt-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${style.icon}`}>
        {style.symbol}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium leading-5">{title}</div>
        {children && <div className="text-[11px] leading-4 opacity-85 break-words">{children}</div>}
      </div>
      {action && onAction && (
        <button onClick={onAction} className={`shrink-0 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${style.action}`}>
          {action}
        </button>
      )}
      <button onClick={onDismiss} aria-label={`Dismiss ${title}`} title="Dismiss"
        className="shrink-0 px-1 text-base leading-5 opacity-60 hover:opacity-100">×</button>
    </div>
  );
}
