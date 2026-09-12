// A language context in the project (Rust, TypeScript, C++, etc.)
export interface Tree {
  id: string;              // "rust-core"
  label: string;           // "Rust (Core)"
  language: string;        // "rust"
  root: string;            // "src-tauri/"
  color: string;           // tailwind color for the icon, e.g. "text-orange-400"
  icon: string;            // emoji or letter for now, real icons later
  nodes: FileNode[];       // top-level children
}

// A file or folder in the tree
export interface FileNode {
  id: string;              // unique: "rust-core/src/main.rs"
  name: string;            // "main.rs"
  path: string;            // "src/main.rs" (relative to tree root)
  kind: "file" | "folder";
  children?: FileNode[];   // only for folders
  hasBreakpoint?: boolean; // show a red dot in the sidebar
  vcsStatus?: "M" | "A" | "D" | "U"; // modified/added/deleted/untracked
}

// An open tab in the editor
export interface EditorTab {
  fileId: string;          // references FileNode.id
  treeId: string;          // which tree it belongs to
  name: string;            // "main.rs"
  language: string;        // "rust"
  isDirty?: boolean;       // has unsaved changes
}

// A debug context in the dropdown
export interface DebugContext {
  id: string;              // "rust-core"
  label: string;           // "Rust (Core)"
  treeId: string;          // which tree it debugs
  status: "idle" | "running" | "paused" | "errored";
}

// A stack frame in the Call Stack panel
export interface StackFrame {
  id: string;
  name: string;            // "main"
  location: string;        // "src/main.rs:7"
  isActive: boolean;
}

// A breakpoint in the Breakpoints panel
export interface Breakpoint {
  id: string;
  fileId: string;
  location: string;        // "main.rs:7"
}

// The whole project
export interface Project {
  name: string;            // "my-tauri-app"
  root: string;            // "." for now
  trees: Tree[];           // all language trees
}