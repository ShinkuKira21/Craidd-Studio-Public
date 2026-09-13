export type Language =
  | "rust"
  | "typescript"
  | "javascript"
  | "python"
  | "cpp"
  | "csharp"
  | "config";

export type ProjectKind = "application" | "library" | "test";

export interface CraiddProject {
  id: string;
  name: string;
  language: Language | null;      // null = config-only
  root: string;                   // relative to the .craidd's own folder
  kind: ProjectKind;
  path: string;                   // path to the .craidd, relative to solution root (or absolute)
  folder: string;                 // folder relative to solution root (or absolute), for display

  configEnabled: boolean;
  configName?: string;
  configDirectory?: string;

  // Runtime-only
  missing?: boolean;              // true when .craidd file is not on disk
  external?: boolean;             // true when path escapes the solution root
  tree?: FileNode | null;
  treeError?: string | null;
  configTree?: FileNode | null;
  configTreeError?: string | null;
}

export interface BuildEntry {
  target: string;                 // path to the .craidd
  method?: string;                // "cargo" | "npm" | "cmake" | "dotnet" | ...
  command?: string;
  cwd?: string;
}

export interface CraiddSolution {
  name: string;
  root: string;                   // absolute path to the solution root
  projects: CraiddProject[];
  build: BuildEntry[];
  runDefault?: string;            // path to the .craidd
  debugDefault?: string;
  autostart: string[];
}

export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: FileNode[];
}

export interface EditorTab {
  fileId: string;
  name: string;
  language: Language | "plaintext";
  content: string;
}
