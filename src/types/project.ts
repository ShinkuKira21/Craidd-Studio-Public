export type Language =
  | "rust"
  | "typescript"
  | "javascript"
  | "python"
  | "cpp"
  | "csharp"
  | "config";

export interface CraiddProject {
  id: string;
  name: string;
  language: Language;
  root: string;
  path: string;
  folder: string;
  tree?: FileNode | null;
  treeError?: string | null;
}

export interface CraiddSolution {
  name: string;
  root: string;
  projects: CraiddProject[];
  runDefault?: string;
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
