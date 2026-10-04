import { useState } from "react";
import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import { removeLdiBlue, setLdiBlue, setupLdiBlue, useLdi } from "../../store/ldiStore";
import type { LdiCallSite } from "../../store/ldiStore";

export default function BreakpointMenu({ file, line, x, y, callSite, onClose }: {
  file: string; line: number; x: number; y: number; callSite?: LdiCallSite; onClose: () => void;
}) {
  const red = useBreakpoints((state) => state.points.find((point) => point.file === file && point.line === line));
  const active = !!red;
  const linked = useLinkedWindows();
  const blue = useLdi((state) => state.blues.find((point) => point.file === file && point.line === line && point.originLabel === linked.ownWindowLabel));
  const partners = linked.windows.filter((item) => callSite?.partnerLabels.includes(item.windowLabel));
  const [editingCondition, setEditingCondition] = useState<"red" | "blue" | null>(null);
  const [condition, setCondition] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  const saveCondition = () => {
    const save = editingCondition === "blue" && blue
      ? setLdiBlue(file, line, blue.partnerLabel, condition)
      : editingCondition === "red" && red
        ? useBreakpoints.getState().setCondition(file, line, condition)
        : Promise.reject(new Error("Breakpoint no longer exists"));
    void save
      .then(onClose)
      .catch((error) => setMenuError(String(error)));
  };
  const toggle = () => {
    void useBreakpoints.getState().toggle(file, line)
      .then(onClose)
      .catch((error) => setMenuError(String(error)));
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-44 max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 300)), top: Math.max(4, Math.min(y, window.innerHeight - (editingCondition ? 240 : 160))) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
        onClick={toggle}>{active ? "Remove Red Breakpoint" : "Set Red Breakpoint"}</button>
      {red && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-900"
        onClick={() => { setCondition(red.condition ?? ""); setEditingCondition("red"); }}>
        {red.condition ? "Edit red condition…" : "Set red condition…"}</button>}
      {blue ? <button role="menuitem"
        className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { void removeLdiBlue(file, line).then(onClose).catch((error) => setMenuError(String(error))); }}>
        Remove Blue Breakpoint</button>
        : partners.map((partner) => <button key={partner.windowLabel} role="menuitem"
          title={`${file.endsWith(".rs") ? "Rust White Debug · Live Native" : "Gold Linked Debug"} · ${callSite?.entryPoint ?? "native call"}`}
          className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
          onClick={() => { void setLdiBlue(file, line, partner.windowLabel).then(onClose).catch((error) => setMenuError(String(error))); }}>
          Set Native Debugging Breakpoint → CS{partner.windowId}: {partner.selectedConfigName ?? partner.projectName}</button>)}
      {!blue && (callSite?.configNames ?? []).filter((name) => !partners.some((partner) => partner.selectedConfigName === name))
        .map((name) => <button key={name} role="menuitem"
          title={`Open Native Power Config ${name} and set Blue`}
          className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
          onClick={() => { void setupLdiBlue(file, line, name, !red && partners.length === 0).then(onClose).catch((error) => setMenuError(String(error))); }}>
          Set Blue Breakpoint → Open {name}</button>)}
      {blue && blue.mode !== "live-native" && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { setCondition(blue.condition ?? ""); setEditingCondition("blue"); }}>
        {blue.condition ? "Edit blue condition…" : "Set blue condition…"}</button>}
      {editingCondition && <div className="px-3 py-2 space-y-2 text-zinc-200">
        <label className="block" htmlFor="breakpoint-condition">{editingCondition === "red" ? "Red" : "Blue"} condition (blank: every hit)</label>
        <input id="breakpoint-condition" autoFocus value={condition} maxLength={256}
          onChange={(event) => setCondition(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") saveCondition(); if (event.key === "Escape") onClose(); }}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100" />
        {red && blue && <p className="max-w-64 text-amber-300">{blue.mode === "live-native" ? "Red remains an ordinary Rust call-site breakpoint; Native blue inspects the same process in C++." : "Blue owns this line during Gold Debug; red's condition applies in White Debug."}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-2 py-1">Cancel</button>
          <button onClick={saveCondition} className="rounded bg-blue-700 px-2 py-1">Save</button>
        </div>
      </div>}
      {menuError && <div role="alert" className="max-w-72 px-3 py-2 text-amber-300 break-words">{menuError}</div>}
    </div>
  </>;
}
