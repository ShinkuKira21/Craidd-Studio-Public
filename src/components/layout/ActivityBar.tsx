import { useLayout } from "../../store/layoutStore";

type View = "solution" | "search" | "debug" | "settings";

const items: { id: View; title: string; icon: string }[] = [
  { id: "solution", title: "Solution Explorer", icon: "M3 7h18M3 12h18M3 17h18" },
  { id: "search", title: "Search", icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
  { id: "debug", title: "Run & Debug", icon: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" },
  { id: "settings", title: "Settings", icon: "M12 2v20M2 12h20" },
];

export default function ActivityBar() {
  const activeView = useLayout((s) => s.activeView);
  const setActiveView = useLayout((s) => s.setActiveView);
  const sidebarVisible = useLayout && true; // sidebar visibility is in preferences; keep click behavior simple

  return (
    <div className="w-11 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-2 gap-1 shrink-0">
      {items.map((it) => {
        const isActive = it.id === activeView;
        return (
          <button
            key={it.id}
            title={it.title}
            onClick={() => setActiveView(it.id)}
            className={
              "w-8 h-8 rounded flex items-center justify-center transition-colors " +
              (isActive
                ? "bg-zinc-800 text-blue-400"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200")
            }
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d={it.icon} />
            </svg>
          </button>
        );
      })}
      <div className="mt-auto">
        <button className="w-8 h-8 rounded flex items-center justify-center text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
    </div>
  );
}
