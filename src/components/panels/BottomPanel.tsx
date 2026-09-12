import { useState } from "react";

const tabs = [
  { id: "output", label: "Output" },
  { id: "problems", label: "Problems" },
  { id: "terminal", label: "Terminal" },
] as const;

type Tab = typeof tabs[number]["id"];

export default function BottomPanel() {
  const [tab, setTab] = useState<Tab>("output");
  return (
    <div className="bg-zinc-900 border-t border-zinc-800 flex flex-col shrink-0 h-full">
      <div className="h-8 flex items-center px-3 gap-4 border-b border-zinc-800 text-xs shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "pb-1.5 -mb-1.5 border-b-2 transition-colors " +
              (tab === t.id
                ? "text-zinc-200 font-medium border-blue-500"
                : "text-zinc-500 hover:text-zinc-300 border-transparent")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3 mono text-[11.5px] leading-5 text-zinc-600 italic">
        {tab === "output" && "No output yet."}
        {tab === "problems" && "No problems detected."}
        {tab === "terminal" && "Terminal arrives in a future phase."}
      </div>
    </div>
  );
}
