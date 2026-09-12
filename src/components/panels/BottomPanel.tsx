import { useWorkspace } from "../../store/workspaceStore";

const tabs = [
  { id: "debug", label: "Debug Console" },
  { id: "problems", label: "Problems" },
  { id: "terminal", label: "Terminal" },
  { id: "breakpoints", label: "Breakpoints" },
] as const;

export default function BottomPanel() {
  const bottomTab = useWorkspace((s) => s.bottomTab);
  const setBottomTab = useWorkspace((s) => s.setBottomTab);
  const activeDebugContextId = useWorkspace((s) => s.activeDebugContextId);
  const debugContexts = useWorkspace((s) => s.debugContexts);
  const active = debugContexts.find((c) => c.id === activeDebugContextId);

  return (
    <div className="h-48 bg-zinc-900 border-t border-zinc-800 flex flex-col shrink-0">
      <div className="h-8 flex items-center px-3 gap-4 border-b border-zinc-800 text-xs shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setBottomTab(t.id)}
            className={
              "pb-1.5 -mb-1.5 border-b-2 transition-colors " +
              (bottomTab === t.id
                ? "text-zinc-200 font-medium border-blue-500"
                : "text-zinc-500 hover:text-zinc-300 border-transparent")
            }
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-zinc-500">
          <span className={active?.status === "paused" ? "text-yellow-400" : "text-green-400"}>●</span>
          <span className="mono text-[11px]">{active?.label}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3 mono text-[11.5px] leading-5">
        {bottomTab === "debug" && <DebugConsole />}
        {bottomTab === "problems" && <EmptyState text="No problems detected." />}
        {bottomTab === "terminal" && <EmptyState text="Terminal session not started." />}
        {bottomTab === "breakpoints" && <EmptyState text="See the Breakpoints panel on the right." />}
      </div>
    </div>
  );
}

function DebugConsole() {
  return (
    <>
      <div className="text-zinc-500">[debug] Launching: <span className="text-zinc-300">target/debug/my-tauri-app</span></div>
      <div className="text-zinc-500">[lldb-dap] Adapter connected on stdio</div>
      <div className="text-zinc-500">[lldb-dap] Breakpoints set: 2</div>
      <div className="text-green-400">✓ Process launched (pid 48213)</div>
      <div className="text-yellow-400">⏸ Paused at breakpoint: <span className="text-zinc-300">src/main.rs:7</span></div>
      <div className="text-zinc-400 pl-4">→ Builder::default()</div>
      <div className="text-zinc-500 pl-4">frame #1: my_tauri_app::main at src/main.rs:7</div>
      <div className="text-zinc-500 pl-4">frame #2: std::rt::lang_start at rt.rs:166</div>
      <div className="text-blue-400 mt-1">› Press F10 to step over, F11 to step into</div>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-zinc-600 italic">{text}</div>;
}
