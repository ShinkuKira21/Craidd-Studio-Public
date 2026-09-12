import { useState } from "react";
import { useWorkspace, useActiveDebugContextId } from "../../store/workspaceStore";

export default function DebugSidebar() {
  const stackFrames = useWorkspace((s) => s.stackFrames);
  const breakpoints = useWorkspace((s) => s.breakpoints);
  const activeContextId = useActiveDebugContextId();
  const contexts = useWorkspace((s) => s.debugContexts);
  const context = contexts.find((c) => c.id === activeContextId);

  return (
    <div className="w-72 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden shrink-0">
      <div className="h-9 px-3 flex items-center justify-between border-b border-zinc-800 shrink-0">
        <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Debug</span>
        <span className="text-[10px] text-zinc-500 normal-case">{context?.label ?? "—"}</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <Section title="Call Stack">
          {stackFrames.map((f) => (
            <div
              key={f.id}
              className={
                "px-3 py-1 cursor-pointer " +
                (f.isActive
                  ? "bg-blue-600/20 border-l-2 border-blue-500 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800")
              }
            >
              <div className="text-[12px]">{f.name}</div>
              <div className="text-[11px] text-zinc-500 mono">{f.location}</div>
            </div>
          ))}
        </Section>

        <Section title="Variables">
          <div className="px-3 py-0.5 text-[12px] mono">
            <span className="text-zinc-300">name</span>
            <span className="text-zinc-500"> = </span>
            <span className="text-green-400">"World"</span>
          </div>
          <div className="px-3 py-0.5 text-[12px] mono">
            <span className="text-zinc-300">app</span>
            <span className="text-zinc-500"> = </span>
            <span className="text-yellow-300">Builder</span>
          </div>
        </Section>

        <Section title="Watch" defaultOpen={false}>
          <div className="px-3 py-1 text-[12px] mono text-zinc-500 italic">No expressions</div>
        </Section>

        <Section title="Breakpoints">
          {breakpoints.length === 0 ? (
            <div className="px-3 py-1 text-[12px] text-zinc-500 italic">No breakpoints set</div>
          ) : (
            breakpoints.map((bp) => (
              <div key={bp.id} className="px-3 py-1 flex items-center gap-2 text-zinc-300 hover:bg-zinc-800 cursor-pointer">
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span className="mono text-[11.5px] truncate">{bp.location}</span>
              </div>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full h-7 px-3 flex items-center gap-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wide hover:bg-zinc-800/50"
      >
        <svg
          className={"w-3 h-3 transition-transform " + (open ? "rotate-90" : "")}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        {title}
      </button>
      {open && <div className="py-1">{children}</div>}
    </div>
  );
}
