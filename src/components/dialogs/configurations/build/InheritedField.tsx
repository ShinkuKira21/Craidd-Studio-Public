/**
 * A field that shows what the current value inherits from, with an
 * affordance to override. Not wired in this push — it exists so the
 * next push's method forms have a shared control to render.
 *
 * Visual contract:
 *   - Inherited value shown in italics.
 *   - Small ↻ button on the right, muted.
 *   - When overridden, the field is normal weight and the ↻ becomes active.
 */
export default function InheritedField({
  label,
  value,
  source,
  overridden = false,
}: {
  label: string;
  value: string;
  source: string;
  overridden?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-zinc-400">{label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <input
          value={value}
          readOnly
          className={
            "flex-1 min-w-0 bg-zinc-950 border rounded px-2 py-1 text-[12px] " +
            (overridden
              ? "border-zinc-700 text-zinc-200"
              : "border-zinc-800 text-zinc-500 italic")
          }
        />
        <span className="text-[10.5px] text-zinc-600 shrink-0">{source}</span>
        <button
          disabled
          title="Override (next push)"
          className="text-zinc-600 text-xs px-1 disabled:opacity-50"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
