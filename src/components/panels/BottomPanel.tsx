import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBuild } from "../../store/buildStore";
import { useDebug } from "../../store/debugStore";
import { useSolution } from "../../store/solutionStore";
import { useLinkedWindows, revealLinkedProblem } from "../../store/linkedWindowsStore";
import { cleanOutput, isAtOutputBottom } from "../../lib/outputPresentation";
import { formatBuildOutput } from "../../lib/buildDiagnostics";

const tabs = [
  { id: "output", label: "Output" },
  { id: "problems", label: "Problems" },
  { id: "terminal", label: "Terminal" },
] as const;

type Tab = typeof tabs[number]["id"];

export default function BottomPanel() {
  const [tab, setTab] = useState<Tab>("output");
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [errorAttention, setErrorAttention] = useState(false);
  const seenErrors = useRef(new Set<string>());
  const output = useBuild((state) => state.output);
  const debugOutput = useDebug((state) => state.output);
  const debugStatus = useDebug((state) => state.status);
  const artifact = useBuild((state) => state.artifact);
  const problems = useBuild((state) => state.problems);
  const linked = useLinkedWindows();
  const remote = linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel
    && item.windowLabel !== linked.ownWindowLabel);
  const shownProblems = linked.linked ? linked.problems
    : problems.map((problem) => ({ ...problem, windowLabel: "", projectName: "" }));
  const revealFile = useSolution((state) => state.revealFile);
  const errors = shownProblems.filter((problem) => problem.severity === "error").length;
  const errorKeys = JSON.stringify(shownProblems.filter((problem) => problem.severity === "error")
    .map((problem) => `${problem.windowLabel}:${problem.file}:${problem.line}:${problem.column}:${problem.message}`));
  const shownOutput = remote ? formatBuildOutput(remote.output || "No output yet.")
    : cleanOutput((["building", "running", "paused", "error"].includes(debugStatus) && debugOutput) || output || debugOutput || "No output yet.");
  const outputSource = remote?.windowLabel ?? "own";
  const activeId = useBuild((state) => state.activeId);
  const changeFollow = (enabled: boolean) => { followRef.current = enabled; setFollowing(enabled); };

  useEffect(() => {
    const current = new Set<string>(JSON.parse(errorKeys));
    const added = [...current].some((key) => !seenErrors.current.has(key));
    seenErrors.current = current;
    if (current.size === 0 || tab === "problems") setErrorAttention(false);
    else if (added) setErrorAttention(true);
  }, [errorKeys, tab]);
  useEffect(() => {
    if (!errorAttention) return;
    const timer = window.setTimeout(() => setErrorAttention(false), 4000);
    return () => window.clearTimeout(timer);
  }, [errorAttention]);

  // New sessions and switching windows start at the latest output. Subsequent
  // updates follow only while enabled; scrolling up lets the user read history.
  useLayoutEffect(() => {
    followRef.current = true;
    setFollowing(true);
  }, [outputSource]);
  useLayoutEffect(() => {
    if (activeId !== null || debugStatus === "building") {
      followRef.current = true;
      setFollowing(true);
    }
  }, [activeId, debugStatus]);
  useLayoutEffect(() => {
    if (tab === "output" && followRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [shownOutput, artifact, tab, following, outputSource, activeId]);
  return (
    <div className="bg-zinc-900 border-t border-zinc-800 flex flex-col shrink-0 h-full">
      <div className="h-8 flex items-center px-3 gap-4 border-b border-zinc-800 text-xs shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); if (t.id === "problems") setErrorAttention(false); }}
            className={
              "pb-1.5 -mb-1.5 border-b-2 transition-colors " +
              (tab === t.id
                ? "text-zinc-200 font-medium border-blue-500"
                : t.id === "problems" && errors > 0 ? "text-red-400 hover:text-red-300 border-transparent" : "text-zinc-500 hover:text-zinc-300 border-transparent") +
              (t.id === "problems" && errorAttention ? " motion-safe:animate-pulse" : "")
            }
          >
            {t.label}{t.id === "output" && remote ? ` · ${remote.projectName}` : ""}{t.id === "problems" && shownProblems.length > 0 ? ` (${errors || shownProblems.length})` : ""}
          </button>
        ))}
        {tab === "output" && <button type="button" aria-pressed={following}
          title={following ? "Following new output. Scroll up to pause." : "Resume following the latest output"}
          onClick={() => changeFollow(!following)}
          className={"ml-auto text-[11px] whitespace-nowrap " + (following ? "text-blue-400" : "text-zinc-400 hover:text-zinc-200")}>
          {following ? "↓ Following" : "↓ Follow output"}
        </button>}
        <span role="status" className="sr-only">{errorAttention ? `${errors} build errors. Open Problems for details.` : ""}</span>
      </div>
      <div ref={scrollRef} onScroll={(event) => {
        if (tab !== "output") return;
        const node = event.currentTarget;
        changeFollow(isAtOutputBottom(node.scrollTop, node.scrollHeight, node.clientHeight));
      }} className="flex-1 min-h-0 overflow-y-auto scroll-thin p-3 mono text-[11.5px] leading-5 text-zinc-400">
        {tab === "output" && (
          <pre className="whitespace-pre-wrap break-words">
            {renderOutput(shownOutput)}
            {!remote && artifact && debugStatus === "idle" && !output.includes(artifact) ? `\nArtifact: ${artifact}` : ""}
          </pre>
        )}
        {tab === "problems" && (shownProblems.length === 0 ? (
          <div className="text-zinc-500">No build problems for this run.</div>
        ) : (
          <div className="space-y-0.5">
            {linked.linked && <div className="text-[10px] uppercase tracking-wider text-amber-500/80 px-2 pb-1">Linked solution · {linked.members.length} windows</div>}
            {shownProblems.map((problem, index) => (
              <button
                key={`${problem.windowLabel}:${problem.file}:${problem.line}:${problem.column}:${index}`}
                type="button"
                onClick={() => void (async () => {
                  if (!linked.linked) { await revealFile(problem.file, problem.line, problem.column); return; }
                  await revealLinkedProblem(problem.windowLabel, problem);
                  if (remote?.windowLabel === problem.windowLabel && !remote.visible) {
                    await revealFile(problem.file, problem.line, problem.column);
                    if (useSolution.getState().tabs.some((item) => item.fileId === problem.file)) {
                      useLinkedWindows.getState().setRemoteEditing(true);
                    }
                  }
                })().catch((error) => console.error("[craidd] Could not reveal problem:", error))}
                className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 focus-visible:outline focus-visible:outline-blue-500"
                title={`${problem.file}:${problem.line}:${problem.column}`}
              >
                <span className={problem.severity === "error" ? "text-red-400" : "text-amber-400"}>●</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-zinc-200 break-words">{problem.message}</span>
                  <span className="block text-[10px] text-zinc-500 truncate">
                    {linked.linked && <span className="text-amber-500/80">{problem.projectName} · </span>}
                    {problem.file.split("/").pop()}:{problem.line}:{problem.column}
                    {problem.code ? ` · ${problem.code}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {tab === "terminal" && "Terminal arrives in a future phase."}
      </div>
    </div>
  );
}

function browserUrl(text: string): string | null {
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Kestrel can print a wildcard bind address; browsers need a real host.
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
      url.hostname = "localhost";
    }
    return url.toString();
  } catch {
    return null;
  }
}

function renderOutput(output: string) {
  return output.split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    if (!/^https?:\/\//.test(part)) return part;
    const trailing = part.match(/[),.;]+$/)?.[0] ?? "";
    const visible = trailing ? part.slice(0, -trailing.length) : part;
    const target = browserUrl(visible);
    if (!target) return part;
    return (
      <span key={index}>
        <button
          type="button"
          title={`Open ${target} in browser`}
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
          onClick={() => void openUrl(target).catch((error) => {
            useBuild.setState((state) => ({ output: state.output + `Could not open browser: ${String(error)}\n` }));
          })}
        >{visible}</button>{trailing}
      </span>
    );
  });
}
