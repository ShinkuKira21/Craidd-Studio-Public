import { useWorkspace, useActiveDebugContextId } from "../../store/workspaceStore";
import { useLayout } from "../../store/layoutStore";

const stepIcons = {
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  stepOver: "M5 12h14M13 5l7 7-7 7",
  stepInto: "M12 5v14M5 13l7 7 7-7",
  stepOut: "M12 19V5M5 11l7-7 7 7",
  restart: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  stop: "M6 6h12v12H6z",
};

function IconButton({ title, path, filled = false }: { title: string; path: string; filled?: boolean }) {
  return (
    <button
      title={title}
      className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
    >
      <svg
        className="w-3.5 h-3.5"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
      >
        <path d={path} />
      </svg>
    </button>
  );
}

export default function Toolbar() {
  const debugContexts = useWorkspace((s) => s.debugContexts);
  const activeDebugContextId = useActiveDebugContextId();
  const setManualDebugContext = useWorkspace((s) => s.setManualDebugContext);
  const manualOverride = useWorkspace((s) => s.manualDebugContextId);
  const panes = useLayout((s) => s.panes);
  const focusedPaneId = useLayout((s) => s.focusedPaneId);
  const splitPane = useLayout((s) => s.splitPane);

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-2 shrink-0">
      <button className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 text-xs">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M5 3l14 9-14 9V3z" />
        </svg>
        Run
      </button>
      <button className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1.5 text-xs font-medium">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        Debug
      </button>
      <div className="w-px h-5 bg-zinc-700 mx-1" />
      <IconButton title="Pause" path={stepIcons.pause} filled />
      <IconButton title="Step Over" path={stepIcons.stepOver} />
      <IconButton title="Step Into" path={stepIcons.stepInto} />
      <IconButton title="Step Out" path={stepIcons.stepOut} />
      <IconButton title="Restart" path={stepIcons.restart} />
      <IconButton title="Stop" path={stepIcons.stop} filled />
      <div className="w-px h-5 bg-zinc-700 mx-1" />

      {/* Split editor button */}
      <button
        onClick={() => splitPane(focusedPaneId)}
        disabled={panes.length >= 2}
        title={panes.length >= 2 ? "Already split" : "Split Editor Right"}
        className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-default"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M12 3v18" />
        </svg>
      </button>

      <div className="w-px h-5 bg-zinc-700 mx-1" />

      {/* Debug context — DERIVED from focused pane's file, overridable */}
      <div className="relative flex items-center">
        <select
          value={activeDebugContextId}
          onChange={(e) => setManualDebugContext(e.target.value)}
          className="bg-zinc-800 text-zinc-200 text-xs rounded pl-2 pr-6 py-1 appearance-none border border-zinc-700 focus:outline-none focus:border-blue-500"
        >
          {debugContexts.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <svg
          className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        {manualOverride && (
          <button
            onClick={() => setManualDebugContext(null)}
            title="Unpin — follow focused editor"
            className="ml-1 text-yellow-400 hover:text-yellow-200 text-[10px] px-1"
          >
            📌
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
        <span>Build: <span className="text-green-400">✓ passing</span></span>
        <span className="text-zinc-700">|</span>
        <span className="mono">target/debug/my-tauri-app</span>
      </div>
    </div>
  );
}
