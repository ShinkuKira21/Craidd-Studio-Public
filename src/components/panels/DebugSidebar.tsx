export default function DebugSidebar() {
  return (
    <div className="w-72 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden shrink-0">
      <div className="h-9 px-3 flex items-center border-b border-zinc-800 shrink-0">
        <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Debug</span>
      </div>
      <div className="flex-1 flex items-center justify-center px-6 text-center text-[12px] text-zinc-600">
        Debugging arrives in Phase 3.
      </div>
    </div>
  );
}
