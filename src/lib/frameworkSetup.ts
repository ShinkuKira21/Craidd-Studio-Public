// Framework setup suggestions are read-only until the user accepts them.
import type { CraiddSolution, FileNode, Language, Manifest } from "../types/project";

export interface TauriSetupProposal {
  rootPath: string;
  triggerPath: string;
  companion: { folder: "src" | "src-tauri"; name: string; language: Language; existingPath?: string } | null;
  updateFrontendConfig: boolean;
}

interface Marker {
  path: string;
  language: string | null;
}

const suppressionKey = (rootPath: string) => "craidd:tauri-setup-dismissed:" + rootPath;

export function isTauriSuggestionSuppressed(rootPath: string): boolean {
  try { return localStorage.getItem(suppressionKey(rootPath)) === "true"; }
  catch { return false; }
}

export function suppressTauriSuggestion(rootPath: string): void {
  try { localStorage.setItem(suppressionKey(rootPath), "true"); }
  catch { /* Storage may be unavailable; setup still works for this session. */ }
}

/**
 * Inspect only the conventional Tauri sibling folders inside the open workspace.
 * Detection is read-only; the caller must obtain consent before changing markers.
 */
export async function detectTauriSetup(
  solution: CraiddSolution,
  triggerPath: string,
  readNative?: ReadNative,
): Promise<TauriSetupProposal | null> {
  const trigger = solution.projects.find((project) => project.path === triggerPath);
  if (!trigger || trigger.missing || trigger.external) return null;
  const fromFrontend = trigger.folder === "src"
    && (trigger.language === "typescript" || trigger.language === "javascript");
  const fromRust = trigger.folder === "src-tauri" && trigger.language === "rust";
  if (!fromFrontend && !fromRust) return null;

  const rootPath = solution.root.replace(/\/+$/, "");
  const invoke = readNative ?? (await import("@tauri-apps/api/core")).invoke;
  const rootTree = await invoke<FileNode>("read_dir_children", { root: rootPath, path: rootPath });
  const children = rootTree.children ?? [];
  if (!["src", "src-tauri"].every((name) =>
    children.some((child) => child.name === name && child.kind === "folder"))) return null;

  const [rootManifests, rustManifests] = await Promise.all([
    invoke<Manifest[]>("read_manifests", { folder: rootPath }),
    invoke<Manifest[]>("read_manifests", { folder: rootPath + "/src-tauri" }),
  ]);
  const npm = rootManifests.find((manifest) => manifest.kind === "npm");
  const cargo = rustManifests.find((manifest) => manifest.kind === "cargo");
  const scripts = npm?.values.scripts;
  const tauriScript = scripts && typeof scripts === "object"
    ? (scripts as Record<string, unknown>).tauri : null;
  const dependencies = cargo?.values.dependencyNames;
  const bins = cargo?.values.bins;
  if (typeof tauriScript !== "string" || !/\btauri\b/.test(tauriScript)
    || !Array.isArray(dependencies) || !dependencies.includes("tauri")
    || !Array.isArray(bins) || bins.length === 0) return null;

  const frontend = solution.projects.find((project) =>
    project.folder === "src" && !project.missing && !project.external
    && (project.language === "typescript" || project.language === "javascript"));
  const rust = solution.projects.find((project) =>
    project.folder === "src-tauri" && !project.missing && !project.external
    && project.language === "rust");
  const companionFolder = fromFrontend ? "src-tauri" : "src";
  let companion: TauriSetupProposal["companion"] = null;
  if (fromFrontend ? !rust : !frontend) {
    const markers = await invoke<Marker[]>("scan_craidd_in_folder_cmd", {
      folder: rootPath + "/" + companionFolder,
    });
    const matching = markers.filter((marker) => companionFolder === "src-tauri"
      ? marker.language === "rust"
      : marker.language === "typescript" || marker.language === "javascript");
    // Multiple same-purpose markers are ambiguous; do not guess which to add.
    if (matching.length > 1) return null;
    const language: Language = companionFolder === "src-tauri" ? "rust"
      : matching[0]?.language === "typescript" ? "typescript"
      : matching[0]?.language === "javascript" ? "javascript"
      : children.some((child) => child.name === "tsconfig.json" && child.kind === "file")
        ? "typescript" : "javascript";
    companion = {
      folder: companionFolder,
      name: companionFolder === "src-tauri" ? "Tauri Rust" : "Tauri Frontend",
      language,
      existingPath: matching[0]?.path,
    };
  }

  const updateFrontendConfig = !frontend
    || !frontend.configEnabled
    || (frontend.configDirectory !== ".." && frontend.configDirectory !== rootPath);
  if (!companion && !updateFrontendConfig) return null;
  return { rootPath, triggerPath, companion, updateFrontendConfig };
}

type ReadNative = <T>(command: string, args: Record<string, unknown>) => Promise<T>;
