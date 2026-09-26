import { useBreakpoints } from "../../store/breakpointStore";

export default function BreakpointMenu({ file, line, x, y, onClose }: {
  file: string; line: number; x: number; y: number; onClose: () => void;
}) {
  const active = useBreakpoints((state) => state.points.some((point) => point.file === file && point.line === line));
  const toggle = () => {
    void useBreakpoints.getState().toggle(file, line)
      .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
    onClose();
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-44 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 190)), top: Math.max(4, Math.min(y, window.innerHeight - 42)) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
        onClick={toggle}>{active ? "Remove breakpoint" : "Add breakpoint"}</button>
    </div>
  </>;
}
