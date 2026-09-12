export type Language =
  | "rust"
  | "typescript"
  | "javascript"
  | "python"
  | "cpp"
  | "csharp"
  | "config";

/** A filter spec (extensions + exact filenames). */
export interface FilterSpec {
  extensions: string[];
  wellKnownFiles: string[];
}

/**
 * A declared project.
 *
 * One .craidd per folder. The same file can describe:
 *   - a source project (has `language`)
 *   - a config section (has `configEnabled === true`)
 *   - a standalone config (configEnabled=true, language=null)
 */
export interface CraiddProject {
  id: string;
  name: string;
  language: Language | null;      // null = config-only
  root: string;
  path: string;                   // relative path to the .craidd
  folder: string;                 // relative folder from solution root

  // Config section (may be absent)
  configEnabled: boolean;
  configName?: string;            // display name for the config subsection
  configDirectory?: string;       // relative to the .craidd's own folder
  configInclude?: string[];       // user-supplied override (globs; simple suffix match for now)

  // Runtime-only
  tree?: FileNode | null;         // source tree
  treeError?: string | null;
  configTree?: FileNode | null;   // config tree (same folder by default)
  configTreeError?: string | null;
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
