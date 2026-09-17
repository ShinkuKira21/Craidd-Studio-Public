import { useEffect, useMemo, useState } from "react";
import type { CraiddProject, FileNode } from "../../types/project";
import { languageMeta, projectExtensions, projectWellKnownFiles } from "../../lib/languages";
import { useSolution } from "../../store/solutionStore";

type Mode = "fine-tune" | "recalibrate";

interface Props {
  project: CraiddProject;
  projectBaseAbs: string;
  configBaseAbs: string | null;   // null → single-section mode
  mode: Mode;
  onClose: () => void;
}

type Membership = "main" | "config" | "both" | "neither";
type Choice = Membership | "auto";
type Overrides = Pick<CraiddProject, "mainInclude" | "mainExclude" | "configInclude" | "configExclude">;

interface TreeNode {
  node: FileNode;
  membership: Membership;
  depth: number;
  section: "project" | "config";
}

const CONFIG_EXTS = ["json", "toml", "yaml", "yml", "ini", "conf"];

function hasExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".d.ts") && exts.includes("d.ts")) return true;
  if (!lower.includes(".")) return false;
  return exts.some((e) => lower.endsWith("." + e.toLowerCase()));
}

function isCraidd(name: string): boolean {
  return name.toLowerCase().endsWith(".craidd");
}

function isBoundary(node: FileNode): boolean {
  return node.kind === "folder" && !!node.children?.some((child) => isCraidd(child.name));
}

function classifyFile(name: string, project: CraiddProject): Membership {
  const lang = project.language;
  const mainHit = lang && lang !== "config"
    ? hasExt(name, projectExtensions(lang)) ||
      projectWellKnownFiles(lang).some((w) => w === name)
    : false;
  const configHit = project.configEnabled && hasExt(name, CONFIG_EXTS);
  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function classifyFolder(folder: FileNode, project: CraiddProject, isRoot = false): Membership {
  if (!isRoot && isBoundary(folder)) return "neither";
  const descendants = (folder.children ?? []).flatMap(function walk(node: FileNode): FileNode[] {
    if (isCraidd(node.name)) return [];
    if (isBoundary(node)) return [];
    return node.kind === "file" ? [node] : (node.children ?? []).flatMap(walk);
  });
  const mainHit = descendants.some((c) => ["main", "both"].includes(classifyFile(c.name, project)));
  const configHit = descendants.some((c) => ["config", "both"].includes(classifyFile(c.name, project)));
  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function membershipOf(node: FileNode, project: CraiddProject, isRoot = false): Membership {
  if (isCraidd(node.name)) return "neither";
  return node.kind === "folder"
    ? classifyFolder(node, project, isRoot)
    : classifyFile(node.name, project);
}

function overrideAt(path: string, includes: string[] = [], excludes: string[] = []): boolean | undefined {
  const parts = path.split("/");
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join("/");
    if (includes.includes(candidate)) return true;
    if (excludes.includes(candidate)) return false;
  }
  if (includes.includes(".")) return true;
  if (excludes.includes(".")) return false;
  return undefined;
}

function membershipWithOverrides(path: string, auto: Membership, overrides: Overrides): Membership {
  const main = overrideAt(path, overrides.mainInclude, overrides.mainExclude) ?? (auto === "main" || auto === "both");
  const config = overrideAt(path, overrides.configInclude, overrides.configExclude) ?? (auto === "config" || auto === "both");
  return main && config ? "both" : main ? "main" : config ? "config" : "neither";
}

function flatten(
  node: FileNode | null | undefined,
  project: CraiddProject,
  depth: number,
  section: "project" | "config",
  openSet: Set<string>,
  out: TreeNode[],
  isRoot = true,
  withinBoundary = false
): void {
  if (!node) return;
  if (isRoot) {
    out.push({ node, membership: membershipOf(node, project, true), depth, section });
    if (openSet.has(section + ":" + node.id)) return;
  }
  if (!node.children) return;
  const sorted = [...node.children].sort((a, b) => {
    const ka = a.kind === "folder" ? 0 : 1;
    const kb = b.kind === "folder" ? 0 : 1;
    return ka - kb || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const child of sorted) {
    if (isCraidd(child.name)) continue;
    const boundary = isBoundary(child);
    const m = withinBoundary || boundary ? "neither" : membershipOf(child, project);
    const key = section + ":" + child.id;
    out.push({ node: child, membership: m, depth: depth + 1, section });
    if (child.kind === "folder" && openSet.has(key)) {
      flatten(child, project, depth + 1, section, openSet, out, false, withinBoundary || boundary);
    }
  }
}

const COLOR_CFG = "#a1a1aa";

function MemberChip({ m, languageColor }: { m: Membership; languageColor: string }) {
  if (m === "neither") {
    return (
      <span
        title="Not a member"
        className="inline-block w-3.5 h-3.5 rounded-sm border border-zinc-700 bg-zinc-900/40"
      />
    );
  }
  if (m === "both") {
    return (
      <span
        title="In project and config"
        className="inline-flex w-3.5 h-3.5 rounded-sm overflow-hidden border border-zinc-700"
      >
        <span className="w-1/2 h-full" style={{ background: languageColor }} />
        <span className="w-1/2 h-full" style={{ background: COLOR_CFG }} />
      </span>
    );
  }
  if (m === "config") {
    return (
      <span
        title="Config member"
        className="inline-block w-3.5 h-3.5 rounded-sm"
        style={{ background: COLOR_CFG }}
      />
    );
  }
  return (
    <span
      title="Project member"
      className="inline-block w-3.5 h-3.5 rounded-sm"
      style={{ background: languageColor }}
    />
  );
}

function Section({
  title,
  rootAbs,
  tree,
  project,
  section,
  openSet,
  toggle,
  languageColor,
  overrides,
  dualRoot,
  onChoose,
}: {
  title: string;
  rootAbs: string;
  tree: FileNode | null;
  project: CraiddProject;
  section: "project" | "config";
  openSet: Set<string>;
  toggle: (key: string) => void;
  languageColor: string;
  overrides: Overrides;
  dualRoot: boolean;
  onChoose: (section: "project" | "config", path: string, choice: Choice) => void;
}) {
  const rows = useMemo(() => {
    const out: TreeNode[] = [];
    flatten(tree, project, 0, section, openSet, out);
    return out;
  }, [tree, project, section, openSet]);

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <div className="px-4 py-2 bg-zinc-950/60">
        <div className="text-[11px] text-zinc-400 font-medium">{title}</div>
        <div className="text-[10.5px] text-zinc-500 font-mono truncate">{rootAbs}</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-[11px] text-zinc-600 italic">Empty.</div>
      ) : (
        rows.map((row) => {
          const isFolder = row.node.kind === "folder";
          const key = section + ":" + row.node.id;
          const isOpen = row.node.path === "." ? !openSet.has(key) : openSet.has(key);
          const membership = membershipWithOverrides(row.node.path, row.membership, overrides);
          const mainOn = membership === "main" || membership === "both";
          const configOn = membership === "config" || membership === "both";
          const toggleConfig = section === "config" || project.language === "config";
          const checked = toggleConfig ? configOn : mainOn;
          const chipMembership = dualRoot
            ? section === "project"
              ? mainOn ? "main" : "neither"
              : configOn ? "config" : "neither"
            : membership;
          const path = row.node.path;
          const explicit = (dualRoot
            ? section === "project"
              ? [overrides.mainInclude, overrides.mainExclude]
              : [overrides.configInclude, overrides.configExclude]
            : [overrides.mainInclude, overrides.mainExclude, overrides.configInclude, overrides.configExclude]
          ).some((paths) => paths?.includes(path));
          const selected = explicit
            ? dualRoot
              ? section === "project"
                ? membership === "main" || membership === "both" ? "main" : "neither"
                : membership === "config" || membership === "both" ? "config" : "neither"
              : membership
            : "auto";
          return (
            <div
              key={key}
              onClick={() => isFolder && toggle(key)}
              style={{ paddingLeft: `${12 + row.depth * 14}px` }}
              className={
                "flex items-center gap-2 pr-3 py-[3px] text-[12.5px] select-none " +
                (isFolder ? "cursor-pointer hover:bg-zinc-800/60" : "")
              }
            >
              {isFolder ? (
                <svg
                  className={
                    "w-3 h-3 text-zinc-500 shrink-0 transition-transform " +
                    (isOpen ? "rotate-90" : "")
                  }
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={`Include ${row.node.name} in ${toggleConfig ? "config" : "project"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const nextMain = toggleConfig ? mainOn : !mainOn;
                  const nextConfig = toggleConfig ? !configOn : configOn;
                  const choice: Choice = nextMain && nextConfig
                    ? "both"
                    : nextMain ? "main" : nextConfig ? "config" : "neither";
                  onChoose(section, path, choice);
                }}
                className="shrink-0 inline-flex w-4 h-4 items-center justify-center rounded-sm cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <MemberChip m={chipMembership} languageColor={languageColor} />
              </button>
              <span
                className={
                  "truncate flex-1 " + (membership === "neither" ? "text-zinc-500" : "text-zinc-200")
                }
              >
                {row.node.name}
              </span>
              <select
                aria-label={`Membership for ${row.node.name}`}
                title={isFolder ? "Folder choice applies to its contents" : "Choose project membership"}
                value={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChoose(section, path, e.target.value as Choice)}
                className="ml-auto w-[105px] shrink-0 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300 disabled:opacity-50"
              >
                <option value="auto">Automatic</option>
                {(!dualRoot || section === "project") && project.language !== "config" && <option value="main">Project</option>}
                {(!dualRoot || section === "config") && project.configEnabled && <option value="config">Config</option>}
                {!dualRoot && project.configEnabled && project.language !== "config" && <option value="both">Both</option>}
                <option value="neither">Neither</option>
              </select>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function FineTuneDialog({
  project,
  projectBaseAbs,
  configBaseAbs,
  mode,
  onClose,
}: Props) {
  const [projectTree, setProjectTree] = useState<FileNode | null>(null);
  const [configTree, setConfigTree] = useState<FileNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  const saveMembership = useSolution((s) => s.saveMembership);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>(() => mode === "recalibrate" ? {
    mainInclude: [], mainExclude: [], configInclude: [], configExclude: [],
  } : {
    mainInclude: project.mainInclude ?? [], mainExclude: project.mainExclude ?? [],
    configInclude: project.configInclude ?? [], configExclude: project.configExclude ?? [],
  });

  const languageColor =
    project.language && project.language !== "config"
      ? tailwindToHex(languageMeta(project.language).color)
      : "#71717a";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const pt = await invoke<FileNode>("read_dir_tree", { path: projectBaseAbs });
        if (cancelled) return;
        setProjectTree(pt);
        if (configBaseAbs && configBaseAbs !== projectBaseAbs) {
          const ct = await invoke<FileNode>("read_dir_tree", { path: configBaseAbs });
          if (!cancelled) setConfigTree(ct);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectBaseAbs, configBaseAbs]);

  const toggle = (key: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const title = mode === "recalibrate"
    ? `Recalibrate — ${project.name}`
    : `Fine Tune — ${project.name}`;

  const dualRoot = !!configBaseAbs && configBaseAbs !== projectBaseAbs;

  const choose = (section: "project" | "config", path: string, choice: Choice) => {
    setOverrides((prev) => {
      const next: Overrides = {
        mainInclude: (prev.mainInclude ?? []).filter((p) => p !== path),
        mainExclude: (prev.mainExclude ?? []).filter((p) => p !== path),
        configInclude: (prev.configInclude ?? []).filter((p) => p !== path),
        configExclude: (prev.configExclude ?? []).filter((p) => p !== path),
      };
      if (dualRoot && section === "project") {
        next.configInclude = prev.configInclude;
        next.configExclude = prev.configExclude;
      } else if (dualRoot) {
        next.mainInclude = prev.mainInclude;
        next.mainExclude = prev.mainExclude;
      }
      if (choice !== "auto") {
        if ((!dualRoot || section === "project") && project.language !== "config") {
          next[choice === "main" || choice === "both" ? "mainInclude" : "mainExclude"]!.push(path);
        }
        if (project.configEnabled && (!dualRoot || section === "config")) {
          next[choice === "config" || choice === "both" ? "configInclude" : "configExclude"]!.push(path);
        }
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveMembership(project.id, overrides);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[720px] max-h-[78vh] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 shrink-0">
          <span className="text-sm text-zinc-100 font-medium">{title}</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
            editable membership
          </span>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin">
          {error && (
            <div className="px-4 py-3 text-[11px] text-red-400 bg-red-950/40 border-b border-red-900/60">
              {error}
            </div>
          )}
          {!projectTree && !error && (
            <div className="px-4 py-6 text-[12px] text-zinc-600 italic">Loading…</div>
          )}
          {projectTree && !dualRoot && (
            <Section
              title="Project Root"
              rootAbs={projectBaseAbs}
              tree={projectTree}
              project={project}
              section="project"
              openSet={openSet}
              toggle={toggle}
              languageColor={languageColor}
              overrides={overrides}
              dualRoot={dualRoot}
              onChoose={choose}
            />
          )}
          {projectTree && dualRoot && (
            <Section
              title="Project Root"
              rootAbs={projectBaseAbs}
              tree={projectTree}
              project={project}
              section="project"
              openSet={openSet}
              toggle={toggle}
              languageColor={languageColor}
              overrides={overrides}
              dualRoot={dualRoot}
              onChoose={choose}
            />
          )}
          {dualRoot && configTree && (
            <Section
              title="Config Root"
              rootAbs={configBaseAbs!}
              tree={configTree}
              project={project}
              section="config"
              openSet={openSet}
              toggle={toggle}
              languageColor={languageColor}
              overrides={overrides}
              dualRoot={dualRoot}
              onChoose={choose}
            />
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 shrink-0 leading-5">
          Automatic uses file extensions and project boundaries. Folder choices apply to their contents.
          {mode === "recalibrate" && <div>Saving will reset previous manual choices.</div>}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={saving || !projectTree}
            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function tailwindToHex(cls: string): string {
  const map: Record<string, string> = {
    "text-orange-400": "#fb923c",
    "text-blue-400": "#60a5fa",
    "text-yellow-400": "#facc15",
    "text-green-400": "#4ade80",
    "text-purple-400": "#c084fc",
    "text-violet-400": "#a78bfa",
    "text-zinc-400": "#a1a1aa",
  };
  return map[cls] ?? "#a1a1aa";
}
