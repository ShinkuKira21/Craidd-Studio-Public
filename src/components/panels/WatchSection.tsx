import { useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { evaluateExpression, readWatches, writeWatches, type InspectValue } from "../../lib/debugInspect";
import { VariableRow } from "./VariableTree";

type Result = { value: InspectValue } | { error: string };

/** Watch expressions, evaluated against the displayed top frame on every stop. */
export default function WatchSection({ targetLabel, frameId, paused, stopKey }: {
  targetLabel: string | undefined; frameId: number | undefined; paused: boolean; stopKey: string;
}) {
  const solutionPath = useSolution((s) => s.clnPath ?? s.rootPath);
  const [expressions, setExpressions] = useState<string[]>(() => readWatches(solutionPath));
  const [results, setResults] = useState<Record<string, Result>>({});
  const [draft, setDraft] = useState("");
  useEffect(() => { setExpressions(readWatches(solutionPath)); }, [solutionPath]);

  useEffect(() => {
    setResults({});
    if (!paused) return;
    let cancelled = false;
    for (const expression of expressions) {
      evaluateExpression(targetLabel, expression, frameId)
        .then((value) => ({ value: { name: expression, ...value } }), (cause) => ({ error: String(cause) }))
        .then((result) => { if (!cancelled) setResults((all) => ({ ...all, [expression]: result })); });
    }
    return () => { cancelled = true; };
  }, [expressions, targetLabel, frameId, paused, stopKey]);

  const save = (next: string[]) => { setExpressions(next); writeWatches(solutionPath, next); };
  const add = () => {
    const expression = draft.trim();
    if (expression && !expressions.includes(expression)) save([...expressions, expression]);
    setDraft("");
  };
  return <section className="p-3 border-b border-zinc-800">
    <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Watch</div>
    {expressions.map((expression) => {
      const result = results[expression];
      const item = result && "value" in result ? result.value : { name: expression, value: paused ? "…" : "", variablesReference: 0 };
      return <VariableRow key={expression} item={item} targetLabel={targetLabel} stopKey={stopKey}
        error={result && "error" in result ? result.error : null} onRemove={() => save(expressions.filter((e) => e !== expression))} />;
    })}
    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add expression"
      onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setDraft(""); }} onBlur={add}
      className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600" />
    {!paused && expressions.length > 0 && <div className="mt-1 text-zinc-600">Evaluated when the debugger pauses.</div>}
  </section>;
}
