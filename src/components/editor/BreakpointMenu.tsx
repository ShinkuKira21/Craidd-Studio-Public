import { activeForAllLinked, useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";

export default function BreakpointMenu({ file, line, instanceId, x, y, onClose }: {
  file: string; line: number; instanceId: string; x: number; y: number; onClose: () => void;
}) {
  const points = useBreakpoints((state) => state.points);
  const windows = useLinkedWindows((state) => state.windows);
  const instanceIds = [...new Set(windows.map((item) => item.instanceId))];
  const target = windows.find((item) => item.instanceId === instanceId);
  const targetName = target ? `CS${target.windowId}` : "this window";
  const active = points.some((point) => point.file === file && point.line === line &&
    (point.scope === "all" || point.scope === instanceId));
  const allActive = activeForAllLinked(points, file, line, instanceIds);
  const toggle = (all: boolean) => {
    void (all
      ? useBreakpoints.getState().toggleForAllLinked(file, line, instanceIds)
      : useBreakpoints.getState().toggleForInstance(file, line, instanceId, instanceIds))
      .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
    onClose();
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-64 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 265)), top: Math.max(4, Math.min(y, window.innerHeight - 100)) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
        onClick={() => toggle(false)}>{active ? "Remove" : "Set"} breakpoint · {targetName}</button>
      {instanceIds.length > 1 && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-amber-300 hover:bg-amber-900/40"
        onClick={() => toggle(true)}>{allActive ? "Remove" : "Set"} breakpoint · all {instanceIds.length} linked windows</button>}
    </div>
  </>;
}
