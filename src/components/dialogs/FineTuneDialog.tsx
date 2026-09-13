import { useEffect, useMemo, useState } from "react";
import type { CraiddProject, FileNode } from "../../types/project";
import { languageMeta, projectExtensions, projectWellKnownFiles } from "../../lib/languages";

/**
 * Phase 2.1.2.1 — READ-ONLY viewer.
 *
 * Shows the filesystem under the project's root (and, when the config
 * has a declared non-default location, a second section for the config
 * root). Every `.craidd` is hidden — it's a declaration, not content.
 *
 * Membership is derived from the current automation (extensions +
 * depth-1 rule). Save is a no-op until 2.1.3.
 */

type Mode = "fine-tune" | "recalibrate";

interface Props {
  project: CraiddProject;
  projectBaseAbs: string;
  configBaseAbs: string | null;   // null → single-section mode
  mode: Mode;
  onClose: () => void;
}

type Membership = "main" | "config" | "both" | "neither";

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

function classifyFile(name: string, project: CraiddProject, depth: number): Membership {
  if (depth > 0) return "neither";
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

function classifyFolder(folder: FileNode, project: CraiddProject, depth: number): Membership {
  if (depth > 0) return "neither";
  const children = folder.children ?? [];
  const lang = project.language;
  const mainHit = lang && lang !== "config"
    ? children.some(
        (c) =>
          c.kind === "file" &&
          !isCraidd(c.name) &&
          (hasExt(c.name, projectExtensions(lang)) ||
            projectWellKnownFiles(lang).some((w) => w === c.name))
      )
    : false;
  const configHit =
    project.configEnabled &&
    children.some((c) => c.kind === "file" && !isCraidd(c.name) && hasExt(c.name, CONFIG_EXTS));
  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function membershipOf(node: FileNode, project: CraiddProject, depth: number): Membership {
  if (isCraidd(node.name)) return "neither";
  return node.kind === "folder"
    ? classifyFolder(node, project, depth)
    : classifyFile(node.name, project, depth);
}

function flatten(
  node: FileNode | null | undefined,
  project: CraiddProject,
  depth: number,
  section: "project" | "config",
  openSet: Set<string>,
  out: TreeNode[]
): void {
  if (!node || !node.children) return;
  const sorted = [...node.children].sort((a, b) => {
    const ka = a.kind === "folder" ? 0 : 1;
    const kb = b.kind === "folder" ? 0 : 1;
    return ka - kb || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const child of sorted) {
    if (isCraidd(child.name)) continue;
    const m = membershipOf(child, project, depth);
    const key = section + ":" + child.id;
    out.push({ node: child, membership: m, depth, section });
    if (child.kind === "folder" && openSet.has(key)) {
      flatten(child, project, depth + 1, section, openSet, out);
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
}: {
  title: string;
  rootAbs: string;
  tree: FileNode | null;
  project: CraiddProject;
  section: "project" | "config";
  openSet: Set<string>;
  toggle: (key: string) => void;
  languageColor: string;
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
          const isOpen = openSet.has(key);
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
              <MemberChip m={row.membership} languageColor={languageColor} />
              <span
                className={
                  "truncate " + (row.membership === "neither" ? "text-zinc-500" : "text-zinc-200")
                }
              >
                {row.node.name}
              </span>
              {isFolder && (
                <span className="ml-auto text-[10px] text-zinc-600">
                  {row.node.children?.length ?? 0}
                </span>
              )}
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
            read-only preview
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
            />
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 shrink-0 leading-5">
          Membership is derived from the current automation (extension + boundary rules).
          <br />
          <span className="text-zinc-600">
            Deep nodes are never auto-included. Editing &amp; persistence land in 2.1.3.
          </span>
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
          <button
            disabled
            title="Editable membership arrives in Phase 2.1.3"
            className="px-3 py-1 rounded text-xs bg-blue-900/50 text-blue-300/70 cursor-not-allowed"
          >
            Save (2.1.3)
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
