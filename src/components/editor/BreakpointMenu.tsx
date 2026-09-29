import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import { removeLdiBlue, setLdiBlue, useLdi } from "../../store/ldiStore";

export default function BreakpointMenu({ file, line, x, y, onClose }: {
  file: string; line: number; x: number; y: number; onClose: () => void;
}) {
  const active = useBreakpoints((state) => state.points.some((point) => point.file === file && point.line === line));
  const linked = useLinkedWindows();
  const blue = useLdi((state) => state.blues.find((point) => point.file === file && point.line === line && point.originLabel === linked.ownWindowLabel));
  const own = linked.windows.find((item) => item.windowLabel === linked.ownWindowLabel);
  const managedCount = linked.windows.filter((item) => item.ldiRole === "managed").length;
  const partners = linked.windows.filter((item) => item.ldiRole === "native-library" && item.windowLabel !== linked.ownWindowLabel);
  const toggle = () => {
    void useBreakpoints.getState().toggle(file, line)
      .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
    onClose();
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-44 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 280)), top: Math.max(4, Math.min(y, window.innerHeight - 90)) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
        onClick={toggle}>{active ? "Remove breakpoint" : "Add breakpoint"}</button>
      {file.endsWith(".cs") && (blue ? <button role="menuitem"
        className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { void removeLdiBlue().catch((error) => alert(`Native breakpoint: ${String(error)}`)); onClose(); }}>
        Remove Native Debugging Breakpoint</button>
        : partners.length === 1 && managedCount === 1 ? partners.map((partner) => <button key={partner.windowLabel} role="menuitem" disabled={own?.ldiRole !== "managed"}
          title="Gold Linked Debug only. Set blue on an executable DllImport call site."
          className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900 disabled:opacity-40"
          onClick={() => { void setLdiBlue(file, line, partner.windowLabel).catch((error) => alert(`Native breakpoint: ${String(error)}`)); onClose(); }}>
          Native Debugging Breakpoint → CS{partner.windowId}</button>)
        : <button role="menuitem" disabled className="block w-full px-3 py-1.5 text-left text-blue-300 opacity-40">
          {managedCount > 1 ? "Native Debugging Breakpoint (multiple C# hosts are ambiguous)" : partners.length ? "Native Debugging Breakpoint (multiple libraries are ambiguous)" : "Native Debugging Breakpoint (select a library partner)"}</button>)}
    </div>
  </>;
}
