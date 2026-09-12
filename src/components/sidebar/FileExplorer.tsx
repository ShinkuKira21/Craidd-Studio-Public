import { useWorkspace } from "../../store/workspaceStore";
import TreeItem from "./TreeItem";
import type { FileNode } from "../../types/project";

// Build a merged "all files" tree by combining every language tree
// under one virtual root. This is a Phase 1 approximation — Phase 2
// will read the real directory from Rust.
function buildVirtualRoot(): FileNode {
  return {
    id: "root",
    name: "my-tauri-app",
    path: ".",
    kind: "folder",
    children: [
      {
        id: "fe-src-tauri",
        name: "src-tauri",
        path: "src-tauri",
        kind: "folder",
        children: [
          {
            id: "fe-src-tauri-src",
            name: "src",
            path: "src-tauri/src",
            kind: "folder",
            children: [
              { id: "rust-core/src/main.rs", name: "main.rs", path: "src-tauri/src/main.rs", kind: "file", hasBreakpoint: true, vcsStatus: "M" },
              { id: "rust-core/src/lib.rs", name: "lib.rs", path: "src-tauri/src/lib.rs", kind: "file" },
              { id: "rust-core/src/commands.rs", name: "commands.rs", path: "src-tauri/src/commands.rs", kind: "file", hasBreakpoint: true },
            ],
          },
          { id: "rust-core/Cargo.toml", name: "Cargo.toml", path: "src-tauri/Cargo.toml", kind: "file" },
          { id: "rust-core/tauri.conf.json", name: "tauri.conf.json", path: "src-tauri/tauri.conf.json", kind: "file", vcsStatus: "M" },
        ],
      },
      {
        id: "fe-src",
        name: "src",
        path: "src",
        kind: "folder",
        children: [
          { id: "ts-frontend/components", name: "components", path: "src/components", kind: "folder", children: [] },
          { id: "ts-frontend/hooks", name: "hooks", path: "src/hooks", kind: "folder", children: [] },
          { id: "ts-frontend/App.tsx", name: "App.tsx", path: "src/App.tsx", kind: "file", vcsStatus: "M" },
          { id: "ts-frontend/main.tsx", name: "main.tsx", path: "src/main.tsx", kind: "file" },
        ],
      },
      { id: "config/package.json", name: "package.json", path: "package.json", kind: "file" },
      { id: "config/vite.config.ts", name: "vite.config.ts", path: "vite.config.ts", kind: "file" },
      { id: "config/tsconfig.json", name: "tsconfig.json", path: "tsconfig.json", kind: "file" },
    ],
  };
}

export default function FileExplorer() {
  const expandedNodes = useWorkspace((s) => s.expandedNodes);
  const toggleNode = useWorkspace((s) => s.toggleNode);
  const root = buildVirtualRoot();
  const isExpanded = expandedNodes.has(root.id);

  return (
    <div className="flex flex-col min-h-0 border-t border-zinc-800" style={{ flex: "1 1 45%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
          File Explorer
        </span>
        <span className="ml-auto text-[10px] text-zinc-600 normal-case">all files</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        <div className="px-1">
          <div
            onClick={() => toggleNode(root.id)}
            className="flex items-center gap-1 px-1 py-[3px] rounded hover:bg-zinc-800 cursor-pointer text-zinc-200 select-none"
          >
            <svg
              className={"w-3 h-3 text-zinc-500 shrink-0 transition-transform " + (isExpanded ? "rotate-90" : "")}
              fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="shrink-0">
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </span>
            <span className="font-medium text-[12.5px]">{root.name}</span>
          </div>
          {isExpanded && root.children?.map((node) => (
            <TreeItem key={node.id} node={node} depth={1} />
          ))}
        </div>
      </div>
    </div>
  );
}
