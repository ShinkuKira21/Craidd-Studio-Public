import type { ConfigEntry } from "../../../../../types/project";

export default function ComposedFields({ config }: { config: ConfigEntry }) {
  const steps = deriveSteps(config);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-[12px] text-zinc-400">Steps</span>
        <div className="flex-1 min-w-0 text-[11.5px] text-zinc-500 italic">
          Composed from other Configurations. The step editor is a
          follow-up push.
        </div>
      </div>

      <div className="pl-28 space-y-1.5">
        {steps.map((s, i) => (
          <div
            key={i}
            className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px]"
          >
            <span className="text-zinc-500 w-5 text-right">{i + 1}.</span>
            <span className="text-zinc-300 truncate flex-1">{s}</span>
          </div>
        ))}
      </div>

      <div className="pl-28 pt-1 text-[11px] text-zinc-600 leading-4">
        Debug is not available for composed Configurations. Debugging
        attaches to a single project — select a member project's
        Configuration from the tree to debug it.
      </div>
    </div>
  );
}

/** Best-effort step derivation for display. The real step list will
 *  come from config.steps once that field exists. */
function deriveSteps(config: ConfigEntry): string[] {
  if (config.command) {
    return [config.command];
  }
  return ["(no steps declared — step editor arrives in a follow-up push)"];
}
