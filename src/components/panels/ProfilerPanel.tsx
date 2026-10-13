import { useState } from "react";

// Layout only. Profiling arrives in Phase 3.5 (docs/feats/profiling/design-profile-markers.md).
// Nothing here records, starts a tool or shows sample data.
// See docs/uiux/design-public-release-sweep.md §3.

type SubTab = "summary" | "markers" | "cpu" | "memory";

const SUB_TABS: { id: SubTab; label: string; empty: string }[] = [
  { id: "summary", label: "Summary", empty: "Run totals will appear here: wall time, CPU time, allocations and marker hits." },
  { id: "markers", label: "Markers", empty: "Profile markers will be listed here, sortable by time, allocation or calls. Click a row to go to its region." },
  { id: "cpu", label: "CPU", empty: "Wall and CPU time per marker will appear here." },
  { id: "memory", label: "Memory", empty: "Allocation volume per marker will appear here." },
];

export default function ProfilerPanel() {
  const [tab, setTab] = useState<SubTab>("summary");
  const current = SUB_TABS.find((item) => item.id === tab)!;
  return <div className="min-h-0 flex-1 flex flex-col overflow-hidden text-xs">
    <div className="px-3 py-2 border-b border-zinc-800 bg-amber-950/20 text-amber-200">
      Profiling is not implemented yet. It arrives in Phase 3.5.
    </div>
    <section className="p-3 border-b border-zinc-800">
      <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Session</div>
      <div className="flex items-center gap-2">
        <span className="text-zinc-400 flex-1">No profiling session</span>
        <select disabled aria-label="Profiling run" className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-600">
          <option>No runs</option>
        </select>
      </div>
    </section>
    <section className="p-3 border-b border-zinc-800">
      <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Timeline</div>
      <div className="h-14 rounded border border-dashed border-zinc-800 flex items-center justify-center text-zinc-600">
        Marker hits and breakpoint stops will be drawn here.
      </div>
    </section>
    <div role="tablist" aria-label="Profiler views" className="flex shrink-0 border-b border-zinc-800 px-2">
      {SUB_TABS.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} type="button"
        onClick={() => setTab(item.id)}
        className={"px-2.5 py-1.5 border-b-2 -mb-px " + (tab === item.id ? "border-blue-500 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300")}>
        {item.label}
      </button>)}
    </div>
    <div role="tabpanel" className="p-3 text-zinc-500 leading-5">{current.empty}</div>
  </div>;
}
