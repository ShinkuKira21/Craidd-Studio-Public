import { abandonLdi, useLdi } from "../../store/ldiStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";

export default function LdiSessionCard() {
  const session = useLdi((state) => state.session);
  const blues = useLdi((state) => state.blues);
  const own = useLinkedWindows((state) => state.ownWindowLabel);
  const viewed = useLinkedWindows((state) => state.viewedWindowLabel);
  if (!session || session.phase === "stopped") {
    return blues.length ? <section className="p-3 border-b border-zinc-800 text-blue-300">
      <div className="font-semibold mb-1">Native debugging · LDI</div>
      {blues.map((blue) => <div key={blue.file + blue.line} className="mb-2">
        <div>{blue.entryPoint} → CS{blue.partnerWindowId}</div>
        {blue.mode === "typed-interposer" && <div className="text-zinc-400">Typed UTF-8 + byte-buffer proxy</div>}
        {!blue.warning && <div className="text-zinc-400">{blue.mode === "live-native" ? "B inspects the real Rust process at native entry." : `B stops at ${blue.landing === "automatic-entry" ? "native entry (automatic)" : "matching red"}.`}</div>}
        {blue.condition && <div className="text-zinc-400">When {blue.condition}</div>}
        {blue.pendingRestart && <div className="text-amber-300">{blue.mode === "live-native" ? "Bindings are frozen until Rust Debug restarts" : "Pending Gold Restart Debug"}</div>}
        <div className="text-zinc-400">{blue.mode === "live-native" ? "Rust White Debug activates this pair. No driver or separate call-site hold." : "Gold Linked Debug activates this pair."}</div>
        {blue.warning && <div className="text-amber-300 mt-1">⚠ {blue.warning}</div>}
      </div>)}
    </section> : null;
  }
  const partner = own === session.partnerLabel || viewed === session.partnerLabel;
  return <section className="p-3 border-b border-blue-900 bg-blue-950/20">
    <div className="text-blue-300 font-semibold mb-2">Native debugging · LDI</div>
    <div className={session.held ? "text-amber-300" : "text-zinc-300"}>
      {session.held ? session.mode === "typed-interposer" && session.phase === "boundary-wait"
        ? "A advancing to the native pre-call gate"
        : session.mode === "typed-interposer" && session.phase === "failed"
          ? "A held for LDI; check the error below"
          : session.mode === "typed-interposer" && !["reading", "boundary-arming"].includes(session.phase)
            ? "A held before its real C++ call" : "A held at blue"
        : session.phase === "released" ? "B finished → A continues" : session.phase === "abandoned" ? "B abandoned → A continues" : "Waiting for blue"}
    </div>
    <div className="text-zinc-300 mt-1 font-mono break-all">{session.entryPoint}({session.values?.join(", ") ?? session.locals.join(", ")})</div>
    <div className="text-zinc-400 mt-1">B landing: {session.landing === "automatic-entry" ? "native entry (automatic)" : "matching red breakpoint"}</div>
    <div className="text-zinc-500 mt-1">{session.file.split("/").pop()}:{session.line} → CS{session.partnerWindowId}</div>
    {!session.held && blues.length > 1 && <div className="text-zinc-400 mt-2">
      Armed calls: {blues.map((blue) => `${blue.entryPoint} → CS${blue.partnerWindowId}`).join(" · ")}
    </div>}
    {session.held && <div className="text-zinc-400 mt-2">
      {session.phase === "boundary-wait" ? "Waiting for the selected C# thread to reach the native pre-call gate…"
        : session.phase === "building-native" ? "Building B's native driver…"
          : session.phase === "finishing-native" ? "Native call returned; finishing B…"
            : session.phase === "stopping-native" ? "Stopping B; A will execute its original call when B ends."
              : session.phase === "closing-native" ? "Closing B; A will execute its original call and LDI will detach."
                : session.phase === "failed" ? "B was not started or did not finish. Abandon explicitly to let A make its original call."
                  : partner ? "Step the real library here. Finish B to resume A." : "Continue and Step are held until B releases this call."}
    </div>}
    {session.error && <div role="alert" className="mt-2 text-amber-300">{session.error}</div>}
    {partner && session.held && !["building-native", "stopping-native", "closing-native"].includes(session.phase) && <button type="button"
      className="mt-2 px-2 py-1 border border-zinc-600 rounded text-zinc-300 hover:bg-zinc-800"
      onClick={() => {
        if (window.confirm("Abandon this reproduction and let A execute its original call? B's values and edits are not copied to A.")) {
          void abandonLdi(session.token, session.partnerLabel).catch((error) => alert(String(error)));
        }
      }}>Abandon B and continue A</button>}
    <div className="text-[10px] text-zinc-500 mt-2">Separate reproduction; A executes its own call after release. Holding a server can cause connection timeouts.</div>
  </section>;
}
