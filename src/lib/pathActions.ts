// Open/copy actions shared by the File Discovery and Solution Explorer
// context menus. See docs/uiux/design-public-release-sweep.md §4.

/** `path` relative to `root`; "." for the root itself; the absolute path when outside it. */
export function relativePath(root: string | null, path: string): string {
  if (!root) return path;
  const base = root.replace(/\/+$/, "");
  if (path === base) return ".";
  return path.startsWith(base + "/") ? path.slice(base.length + 1) : path;
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function revealInFileManager(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

let vscode: Promise<string | null> | null = null;

/** Looked up once per window; restart Craidd after installing VS Code. */
export function findVsCode(): Promise<string | null> {
  vscode ??= import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<string | null>("find_vscode"))
    .catch(() => null);
  return vscode;
}

export async function openInVsCode(path: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_in_vscode", { path });
}
