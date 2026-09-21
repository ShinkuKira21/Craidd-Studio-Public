import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";

export default function BreakpointMenu({ file, line, instanceId, x, y, onClose }: {
  file: string; line: number; instanceId: string; x: number; y: number; onClose: () => void;
}) {
  const points = useBreakpoints((state) => state.points);
  const windows = useLinkedWindows((state) => state.windows);
  const active = points.some((point) => point.file === file && point.line === line &&
    (point.scope === "all" || point.scope === instanceId));
  const toggle = () => {
    void useBreakpoints.getState().toggleForInstance(file, line, instanceId, windows.map((item) => item.instanceId))
      .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
    onClose();
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-56 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 230)), top: Math.max(4, Math.min(y, window.innerHeight - 90)) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-blue-700"
        onClick={toggle}>{active ? "Delete Breakpoint here" : "Set Breakpoint here"}</button>
      <button role="menuitem" disabled title="Profile breakpoints are planned; no profiling action is available yet"
        className="block w-full px-3 py-1.5 text-left text-zinc-500 cursor-not-allowed">
        {"Set/Delete Profile Breakpoint here (planned)"}
      </button>
    </div>
  </>;
}
