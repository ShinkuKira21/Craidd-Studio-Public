import type { LinkedLaunchPlanPhase } from "../../store/linkedWindowsStore";

export default function LinkedLaunchPlanDialog({ action, phases, launching, error, onStart, onClose }: {
  action: "build" | "run" | "debug";
  phases: LinkedLaunchPlanPhase[];
  launching: boolean;
  error: string | null;
  onStart: () => void;
  onClose: () => void;
}) {
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Linked launch plan" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      className="flex max-h-[calc(100vh-32px)] w-[min(640px,calc(100vw-32px))] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="border-b border-zinc-800 px-5 py-3"><h2 className="text-sm font-medium text-zinc-100">Linked {action} · launch order</h2><p className="mt-1 text-[12px] text-zinc-400">Each group starts together. Craidd waits for {action === "build" ? "successful build completion" : "startup and readiness checks"} before starting the next group.</p></div>
      <ol className="space-y-4 overflow-y-auto px-5 py-4 text-[12px]">
        {phases.map((phase, index) => <li key={phase.priority} className="rounded border border-zinc-800 p-3">
          <div className="mb-2 flex justify-between text-amber-300"><span>{index === 0 ? "Start first" : "Then start"}</span><span className="text-zinc-500">Stage {index + 1}</span></div>
          {phase.members.map((member) => <div key={member.windowId} className="mt-2 space-y-1">
            <div className="text-zinc-200">{member.projectName} <span className="text-zinc-500">· CS{member.windowId}</span></div>
            {member.preparation.length > 0 && <ol className="list-decimal space-y-1 pl-5 text-zinc-300">{member.preparation.map((step, index) => <li key={index}>{step}</li>)}</ol>}
            <div className="break-words font-mono text-[11px] text-zinc-500">{member.command}</div>
            {action !== "build" && member.readyUrl && <div className="break-words text-blue-300">Wait for {member.readyUrl} <span className="text-zinc-500">· up to {member.timeoutMs / 1000}s</span></div>}
          </div>)}
        </li>)}
      </ol>
      {error && <p role="alert" className="px-5 pb-3 text-[12px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3"><button type="button" disabled={launching} onClick={onClose} className="px-3 py-1.5 text-[12px] text-zinc-400">Cancel</button><button autoFocus type="button" disabled={launching} onClick={onStart} className="rounded bg-blue-700 px-3 py-1.5 text-[12px] text-white disabled:bg-zinc-800">{launching ? "Starting…" : `Start linked ${action}`}</button></div>
    </div>
  </div>;
}
