import { useState } from "react";
import DebugSidebar from "./DebugSidebar";
import ProfilerPanel from "./ProfilerPanel";

type Tab = "debugger" | "profiler";
const TAB_KEY = "craidd:right-panel-tab";

function readTab(): Tab {
  try { return localStorage.getItem(TAB_KEY) === "profiler" ? "profiler" : "debugger"; } catch { return "debugger"; }
}

/** The right panel: Debugger and Profiler tabs, in the style of Visual Studio's Diagnostic Tools. */
export default function RightPanel() {
  const [tab, setTab] = useState<Tab>(readTab);
  const choose = (next: Tab) => {
    setTab(next);
    try { localStorage.setItem(TAB_KEY, next); } catch { /* Best effort. */ }
  };
  return <div className="h-full min-h-0 w-full bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden text-xs">
    <div role="tablist" aria-label="Right panel" className="h-9 shrink-0 flex items-end gap-1 px-2 border-b border-zinc-800">
      {(["debugger", "profiler"] as const).map((id) => <button key={id} role="tab" type="button" aria-selected={tab === id}
        onClick={() => choose(id)}
        className={"px-3 py-1.5 border-b-2 -mb-px font-semibold uppercase tracking-wide " + (tab === id ? "border-blue-500 text-zinc-200" : "border-transparent text-zinc-500 hover:text-zinc-300")}>
        {id === "debugger" ? "Debugger" : "Profiler"}
      </button>)}
    </div>
    {tab === "debugger" ? <DebugSidebar /> : <ProfilerPanel />}
  </div>;
}
