import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch, type FileMatch, type FileNameMatch } from "../../../store/searchStore";
import { useSolution } from "../../../store/solutionStore";

/**
 * Phase 2.1.3 — sidebar Search.
 *
 * Ranking tiers (highest to lowest):
 *   1. In Open Editors   (content matches from files in the tabs list)
 *   2. Files             (filename matches — frontend only, instant)
 *   3. In Solution       (content matches in solution-declared files)
 *   4. In Discovery      (everything else)
 *
 * Auto-expand breadth narrows as result count grows:
 *   1–5 files    → expand all
 *   6–30 files   → expand top 3 (open-editor > match-count > alpha)
 *   31+ files    → collapse all
 *
 * Collapsed rows always show a muted preview of their top match.
 * Hover reveals the full first line. Click expands.
 */

const DEBOUNCE_MS = 300;

export default function SearchPanel() {
  const query = useSearch((s) => s.query);
  const run = useSearch((s) => s.run);
  const contentMatches = useSearch((s) => s.contentMatches);
  const fileNameMatches = useSearch((s) => s.fileNameMatches);
  const searching = useSearch((s) => s.searching);
  const error = useSearch((s) => s.error);
  const expandedPaths = useSearch((s) => s.expandedPaths);
  const toggleExpanded = useSearch((s) => s.toggleExpanded);
  const expandPath = useSearch((s) => s.expandPath);

  const tabs = useSolution((s) => s.tabs);
  const solution = useSolution((s) => s.solution);
  const rootPath = useSolution((s) => s.rootPath);

  const [local, setLocal] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void run(local);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [local, run]);

  const openPaths = useMemo(() => new Set(tabs.map((t) => t.fileId)), [tabs]);

  const solutionProjectRoots = useMemo(() => {
    if (!solution || !rootPath) return [] as string[];
    return solution.projects.map((p) => {
      if (p.folder === "." || p.folder === "") return rootPath.replace(/\/+$/, "");
      return `${rootPath.replace(/\/+$/, "")}/${p.folder.replace(/^\/+/, "")}`;
    });
  }, [solution, rootPath]);

  const isInsideSolution = (abs: string) =>
    solutionProjectRoots.some((r) => abs === r || abs.startsWith(r + "/"));

  // ── Bucket content matches ──
  const { openEditors, inSolution, inDiscovery } = useMemo(() => {
    const openEditors: FileMatch[] = [];
    const inSolution: FileMatch[] = [];
    const inDiscovery: FileMatch[] = [];
    for (const m of contentMatches) {
      if (openPaths.has(m.path)) openEditors.push(m);
      else if (isInsideSolution(m.path)) inSolution.push(m);
      else inDiscovery.push(m);
    }
    return { openEditors, inSolution, inDiscovery };
  }, [contentMatches, openPaths, solutionProjectRoots]);

  // ── Auto-expand based on total file count ──
  useEffect(() => {
    const allFiles = [...openEditors, ...inSolution, ...inDiscovery];
    const count = allFiles.length;
    if (count === 0) return;

    if (count <= 5) {
      for (const f of allFiles) expandPath(f.path);
      return;
    }
    if (count <= 30) {
      const ranked = [...allFiles].sort((a, b) => {
        const aOpen = openPaths.has(a.path) ? 0 : 1;
        const bOpen = openPaths.has(b.path) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        const aCount = a.matches.length;
        const bCount = b.matches.length;
        if (aCount !== bCount) return bCount - aCount;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      for (const f of ranked.slice(0, 3)) expandPath(f.path);
    }
  }, [openEditors, inSolution, inDiscovery, expandPath, openPaths]);

  const totalMatches = contentMatches.reduce((n, m) => n + m.matches.length, 0);
  const totalFiles = contentMatches.length;
  const hasQuery = local.trim().length > 0;

  const onOpenMatch = async (abs: string, line?: number) => {
    const tab = tabs.find((t) => t.fileId === abs);
    if (tab) {
      useSolution.getState().setActiveFile(abs);
    } else {
      const name = abs.split("/").pop() ?? abs;
      await useSolution.getState().openFile(abs, name);
    }
    // Note: line-reveal lands when Monaco gains an imperative handle (2.2).
    // For now, opening the file is the jump.
    void line;
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Input */}
      <div className="px-3 pt-3 pb-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 focus-within:border-blue-500">
          <svg
            className="w-3.5 h-3.5 text-zinc-500 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            ref={inputRef}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Search files and content…"
            className="flex-1 bg-transparent text-zinc-100 text-[12.5px] outline-none placeholder:text-zinc-500"
          />
          {local && (
            <button
              onClick={() => setLocal("")}
              className="text-zinc-500 hover:text-zinc-300 text-sm leading-none"
              title="Clear"
            >
              ×
            </button>
          )}
        </div>
        {hasQuery && (
          <div className="mt-1.5 text-[10.5px] text-zinc-500">
            {searching
              ? "Searching…"
              : `${totalMatches} match${totalMatches === 1 ? "" : "es"} in ${totalFiles} file${totalFiles === 1 ? "" : "s"}`}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {error && (
          <div className="mx-3 my-2 px-2 py-1.5 text-[11px] text-red-400 bg-red-950/40 border border-red-900/60 rounded">
            {error}
          </div>
        )}

        {!hasQuery && (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center leading-5">
            Type to search file names and content.
          </div>
        )}

        {hasQuery && !searching && totalFiles === 0 && fileNameMatches.length === 0 && (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center">
            No results.
          </div>
        )}

        {hasQuery && fileNameMatches.length > 0 && (
          <Section
            title="Files"
            count={fileNameMatches.length}
            defaultOpen={true}
            collapsible={false}
          >
            {fileNameMatches.slice(0, 40).map((m) => (
              <FileNameRow key={m.path} match={m} query={local} onOpen={() => onOpenMatch(m.path)} />
            ))}
          </Section>
        )}

        {hasQuery && openEditors.length > 0 && (
          <Section title="In Open Editors" count={openEditors.length}>
            {openEditors.map((m) => (
              <FileRow
                key={m.path}
                match={m}
                query={local}
                expanded={expandedPaths.has(m.path)}
                onToggle={() => toggleExpanded(m.path)}
                onOpen={(line) => onOpenMatch(m.path, line)}
              />
            ))}
          </Section>
        )}

        {hasQuery && inSolution.length > 0 && (
          <Section title="In Solution" count={inSolution.length}>
            {inSolution.map((m) => (
              <FileRow
                key={m.path}
                match={m}
                query={local}
                expanded={expandedPaths.has(m.path)}
                onToggle={() => toggleExpanded(m.path)}
                onOpen={(line) => onOpenMatch(m.path, line)}
              />
            ))}
          </Section>
        )}

        {hasQuery && inDiscovery.length > 0 && (
          <Section title="In Discovery" count={inDiscovery.length}>
            {inDiscovery.slice(0, 100).map((m) => (
              <FileRow
                key={m.path}
                match={m}
                query={local}
                expanded={expandedPaths.has(m.path)}
                onToggle={() => toggleExpanded(m.path)}
                onOpen={(line) => onOpenMatch(m.path, line)}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
  collapsible = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        disabled={!collapsible}
        onClick={() => collapsible && setOpen((v) => !v)}
        className={
          "w-full flex items-center gap-1 px-2.5 py-1 text-[11px] uppercase tracking-wide " +
          (collapsible ? "text-zinc-400 hover:bg-zinc-800/60" : "text-zinc-500 cursor-default")
        }
      >
        {collapsible && (
          <svg
            className={"w-3 h-3 shrink-0 transition-transform " + (open ? "rotate-90" : "")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        )}
        <span>{title}</span>
        <span className="ml-auto text-zinc-600 normal-case">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function FileNameRow({
  match,
  query,
  onOpen,
}: {
  match: FileNameMatch;
  query: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      title={match.path}
      className="w-full flex items-center gap-2 px-2.5 py-[3px] text-left text-[12.5px] text-zinc-300 hover:bg-zinc-800 rounded"
    >
      <svg
        className="w-3.5 h-3.5 text-zinc-500 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <Highlighted text={match.name} query={query} />
    </button>
  );
}

function FileRow({
  match,
  query,
  expanded,
  onToggle,
  onOpen,
}: {
  match: FileMatch;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (line: number) => void;
}) {
  const top = match.matches[0];
  const preview = top ? top.text : "";
  const totalInFile = match.matches.length;

  return (
    <div>
      <button
        onClick={onToggle}
        title={match.path}
        className="w-full flex items-start gap-1.5 px-2.5 py-[3px] text-left hover:bg-zinc-800 rounded"
      >
        <svg
          className={
            "w-3 h-3 mt-[3px] shrink-0 text-zinc-500 transition-transform " +
            (expanded ? "rotate-90" : "")
          }
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12.5px] text-zinc-200">
            <span className="truncate">
              <Highlighted text={match.name} query={query} />
            </span>
            <span className="ml-auto text-[10.5px] text-zinc-500 shrink-0">
              {totalInFile} match{totalInFile === 1 ? "" : "es"}
            </span>
          </div>
          {!expanded && preview && (
            <div
              title={top?.text}
              className="text-[11px] text-zinc-500 truncate leading-4"
            >
              <Highlighted text={preview} query={query} muted />
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="pl-6">
          {match.matches.map((lm) => (
            <button
              key={lm.lineNumber}
              onClick={() => onOpen(lm.lineNumber)}
              className="w-full flex items-start gap-2 px-2 py-[2px] text-left text-[11.5px] hover:bg-zinc-800 rounded"
            >
              <span className="text-zinc-600 font-mono shrink-0 w-10 text-right">
                {lm.lineNumber}
              </span>
              <span className="text-zinc-400 truncate">
                <Highlighted text={lm.text} query={query} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Highlighted({
  text,
  query,
  muted = false,
}: {
  text: string;
  query: string;
  muted?: boolean;
}) {
  const q = query.trim();
  if (!q) return <span>{text}</span>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(ql);
  let key = 0;
  while (idx >= 0) {
    if (idx > i) parts.push(<span key={key++}>{text.slice(i, idx)}</span>);
    parts.push(
      <mark
        key={key++}
        className={
          muted
            ? "bg-blue-900/60 text-blue-100 rounded-sm px-[1px]"
            : "bg-blue-800/70 text-blue-100 rounded-sm px-[1px]"
        }
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
    idx = lower.indexOf(ql, i);
  }
  if (i < text.length) parts.push(<span key={key++}>{text.slice(i)}</span>);
  return <>{parts}</>;
}
