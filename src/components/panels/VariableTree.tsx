import { useEffect, useState } from "react";
import { inspectVariables, type InspectValue } from "../../lib/debugInspect";

/** One variable row; children load when expanded and are dropped on the next stop (`stopKey`). */
export function VariableRow({ item, targetLabel, stopKey, depth = 0, error, onRemove }: {
  item: InspectValue; targetLabel: string | undefined; stopKey: string; depth?: number;
  error?: string | null; onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<InspectValue[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { setOpen(false); setChildren(null); setLoadError(null); }, [stopKey]);
  const expandable = item.variablesReference > 0 && !error;
  const toggle = () => {
    if (!expandable) return;
    const next = !open;
    setOpen(next);
    if (next && !children) {
      inspectVariables(targetLabel, item.variablesReference)
        .then((values) => { setChildren(values); setLoadError(null); })
        .catch((cause) => setLoadError(String(cause)));
    }
  };
  return <div>
    <div className="group py-0.5 flex gap-2 items-baseline" style={{ paddingLeft: depth * 12 }}>
      <button type="button" onClick={toggle} aria-expanded={expandable ? open : undefined}
        className={"w-3 shrink-0 text-zinc-500 " + (expandable ? "hover:text-zinc-200" : "invisible")}>{open ? "▾" : "▸"}</button>
      <span className="text-blue-300 truncate shrink-0 max-w-[45%]" title={item.type ? `${item.name}: ${item.type}` : item.name}>{item.name}</span>
      {error
        ? <span className="text-red-300 truncate" title={error}>{error}</span>
        : <span className="text-zinc-300 truncate min-w-0 flex-1" title={item.value}>{item.value}</span>}
      {onRemove && <button type="button" onClick={onRemove} title="Remove watch"
        className="ml-auto opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200">×</button>}
    </div>
    {open && loadError && <div className="text-red-300 truncate" style={{ paddingLeft: (depth + 1) * 12 + 20 }} title={loadError}>{loadError}</div>}
    {open && children?.map((child, index) => <VariableRow key={`${child.name}-${index}`} item={child}
      targetLabel={targetLabel} stopKey={stopKey} depth={depth + 1} />)}
    {open && children?.length === 0 && <div className="text-zinc-600 italic" style={{ paddingLeft: (depth + 1) * 12 + 20 }}>No members</div>}
  </div>;
}
