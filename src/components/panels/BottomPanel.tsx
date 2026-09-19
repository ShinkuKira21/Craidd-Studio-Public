import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBuild } from "../../store/buildStore";
import { useSolution } from "../../store/solutionStore";

const tabs = [
  { id: "output", label: "Output" },
  { id: "problems", label: "Problems" },
  { id: "terminal", label: "Terminal" },
] as const;

type Tab = typeof tabs[number]["id"];

export default function BottomPanel() {
  const [tab, setTab] = useState<Tab>("output");
  const output = useBuild((state) => state.output);
  const artifact = useBuild((state) => state.artifact);
  const problems = useBuild((state) => state.problems);
  const revealFile = useSolution((state) => state.revealFile);
  const errors = problems.filter((problem) => problem.severity === "error").length;
  return (
    <div className="bg-zinc-900 border-t border-zinc-800 flex flex-col shrink-0 h-full">
      <div className="h-8 flex items-center px-3 gap-4 border-b border-zinc-800 text-xs shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "pb-1.5 -mb-1.5 border-b-2 transition-colors " +
              (tab === t.id
                ? "text-zinc-200 font-medium border-blue-500"
                : "text-zinc-500 hover:text-zinc-300 border-transparent")
            }
          >
            {t.label}{t.id === "problems" && problems.length > 0 ? ` (${errors || problems.length})` : ""}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3 mono text-[11.5px] leading-5 text-zinc-400">
        {tab === "output" && (
          <pre className="whitespace-pre-wrap break-words">
            {renderOutput(output || "No output yet.")}
            {artifact && !output.includes(artifact) ? `\nArtifact: ${artifact}` : ""}
          </pre>
        )}
        {tab === "problems" && (problems.length === 0 ? (
          <div className="text-zinc-500">No build problems for this run.</div>
        ) : (
          <div className="space-y-0.5">
            {problems.map((problem, index) => (
              <button
                key={`${problem.file}:${problem.line}:${problem.column}:${index}`}
                type="button"
                onClick={() => void revealFile(problem.file, problem.line, problem.column)}
                className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 focus-visible:outline focus-visible:outline-blue-500"
                title={`${problem.file}:${problem.line}:${problem.column}`}
              >
                <span className={problem.severity === "error" ? "text-red-400" : "text-amber-400"}>●</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-zinc-200 break-words">{problem.message}</span>
                  <span className="block text-[10px] text-zinc-500 truncate">
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
