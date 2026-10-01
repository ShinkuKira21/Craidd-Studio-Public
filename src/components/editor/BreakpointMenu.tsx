import { useState } from "react";
import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import { removeLdiBlue, setLdiBlue, useLdi } from "../../store/ldiStore";

export default function BreakpointMenu({ file, line, x, y, onClose }: {
  file: string; line: number; x: number; y: number; onClose: () => void;
}) {
  const red = useBreakpoints((state) => state.points.find((point) => point.file === file && point.line === line));
  const active = !!red;
  const linked = useLinkedWindows();
  const blue = useLdi((state) => state.blues.find((point) => point.file === file && point.line === line && point.originLabel === linked.ownWindowLabel));
  const own = linked.windows.find((item) => item.windowLabel === linked.ownWindowLabel);
  const managedCount = linked.windows.filter((item) => item.ldiRole === "managed").length;
  const partners = linked.windows.filter((item) => item.ldiRole === "native-library" && item.windowLabel !== linked.ownWindowLabel);
  const [editingCondition, setEditingCondition] = useState<"red" | "blue" | null>(null);
  const [condition, setCondition] = useState("");
  const saveCondition = () => {
    const save = editingCondition === "blue" && blue
      ? setLdiBlue(file, line, blue.partnerLabel, condition)
      : editingCondition === "red" && red
        ? useBreakpoints.getState().setCondition(file, line, condition)
        : Promise.reject(new Error("Breakpoint no longer exists"));
    void save
      .then(onClose)
      .catch((error) => alert(`Breakpoint condition: ${String(error)}`));
  };
  const toggle = () => {
    void useBreakpoints.getState().toggle(file, line)
      .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
    onClose();
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-44 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 280)), top: Math.max(4, Math.min(y, window.innerHeight - (editingCondition ? 190 : 90))) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
        onClick={toggle}>{active ? "Remove breakpoint" : "Add breakpoint"}</button>
      {red && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-900"
        onClick={() => { setCondition(red.condition ?? ""); setEditingCondition("red"); }}>
        {red.condition ? "Edit red condition…" : "Set red condition…"}</button>}
      {file.endsWith(".cs") && (blue ? <button role="menuitem"
        className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { void removeLdiBlue(file, line).catch((error) => alert(`Native breakpoint: ${String(error)}`)); onClose(); }}>
        Remove Native Debugging Breakpoint</button>
        : partners.length > 0 && managedCount === 1 ? partners.map((partner) => <button key={partner.windowLabel} role="menuitem" disabled={own?.ldiRole !== "managed"}
          title="Gold Linked Debug only. Set blue on an executable DllImport call site."
          className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900 disabled:opacity-40"
          onClick={() => { void setLdiBlue(file, line, partner.windowLabel).catch((error) => alert(`Native breakpoint: ${String(error)}`)); onClose(); }}>
          Native Debugging Breakpoint → CS{partner.windowId}{partner.selectedConfigName ? ` · ${partner.selectedConfigName}` : ""}</button>)
        : <button role="menuitem" disabled className="block w-full px-3 py-1.5 text-left text-blue-300 opacity-40">
          {managedCount > 1 ? "Native Debugging Breakpoint (multiple C# hosts are ambiguous)" : "Native Debugging Breakpoint (select a library partner)"}</button>)}
      {blue && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { setCondition(blue.condition ?? ""); setEditingCondition("blue"); }}>
        {blue.condition ? "Edit blue condition…" : "Set blue condition…"}</button>}
      {editingCondition && <div className="px-3 py-2 space-y-2 text-zinc-200">
        <label className="block" htmlFor="breakpoint-condition">{editingCondition === "red" ? "Red" : "Blue"} condition (blank: every hit)</label>
        <input id="breakpoint-condition" autoFocus value={condition} maxLength={256}
          onChange={(event) => setCondition(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") saveCondition(); if (event.key === "Escape") onClose(); }}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100" />
        {red && blue && <p className="max-w-64 text-amber-300">Blue owns this line during Gold Debug; red's condition applies in White Debug.</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-2 py-1">Cancel</button>
          <button onClick={saveCondition} className="rounded bg-blue-700 px-2 py-1">Save</button>
        </div>
      </div>}
    </div>
  </>;
}
