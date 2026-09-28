import { useState } from "react";
import type { ConfigEntry, LinkedLaunch } from "../../../types/project";
import type { LinkedStartupSuggestion } from "../../../lib/linkedStartup";

export interface StartupSetup {
  serverNames: string[];
  clientNames: string[];
  serverPolicy: LinkedLaunch;
  clientPriority: number;
}

function preferredConfigs(configs: ConfigEntry[]): string[] {
  const groups = new Map<string, ConfigEntry[]>();
  for (const config of configs) {
    const key = `${config.target}:${config.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), config]);
  }
  return [...groups.values()].map((group) => {
    const best = group.find((config) => config.origin === "user" && /\btauri\s+dev\b/.test(config.command ?? ""))
      ?? group.find((config) => config.origin === "user") ?? group.find((config) => config.bestFit) ?? group[0];
    return best.name;
  });
}

const inputClass = "w-full min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100";

export default function LinkedStartupWizard({ suggestion, configs, onCancel, onApply }: {
  suggestion: LinkedStartupSuggestion;
  configs: ConfigEntry[];
  onCancel: () => void;
  onApply: (setup: StartupSetup) => void;
}) {
  const servers = configs.filter((config) => suggestion.configurationNames.includes(config.name));
  const clients = configs.filter((config) => suggestion.clientConfigurationNames.includes(config.name));
  const [serverNames, setServerNames] = useState(() => preferredConfigs(servers));
  const [clientNames, setClientNames] = useState(() => preferredConfigs(clients));
  const [priority, setPriority] = useState(20);
  const [clientPriority, setClientPriority] = useState(50);
  const [readyUrl, setReadyUrl] = useState(suggestion.readyUrl);
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setTestMessage(await invoke<boolean>("probe_linked_readiness", { url: readyUrl })
        ? "Ready: the endpoint returned a successful HTTP response."
        : "No successful response. Start the API separately to test, or save setup for its next launch.");
    } catch (error) { setTestMessage(`Could not test: ${String(error)}`); }
    finally { setTesting(false); }
  };
  let validUrl = false;
  try { const url = new URL(readyUrl); validUrl = readyUrl.startsWith("http://") && !/[\s\\]/.test(readyUrl)
    && url.protocol === "http:" && !url.username && !url.password && !url.hash && url.port !== "0"; } catch { /* incomplete input */ }
  const valid = Number.isInteger(priority) && priority >= 1 && priority < clientPriority
    && Number.isInteger(clientPriority) && clientPriority <= 100
    && timeoutSeconds >= 0.1 && timeoutSeconds <= 300 && serverNames.length > 0 && clientNames.length > 0 && validUrl;
  const options = (title: string, entries: ConfigEntry[], names: string[], update: (names: string[]) => void) => (
    <fieldset className="space-y-1.5">
      <legend className="mb-2 font-medium text-zinc-200">{title}</legend>
      {entries.map((config) => <label key={config.name} className="flex items-center gap-2 text-zinc-400">
        <input type="checkbox" checked={names.includes(config.name)} onChange={(event) => update(event.target.checked ? [...names, config.name] : names.filter((name) => name !== config.name))} />
        <span className="min-w-0 break-words">{config.name} <span className="text-zinc-500">· {config.kind}{config.origin === "inferred" ? " · customize" : ""}</span></span>
      </label>)}
    </fieldset>
  );
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70" onClick={(event) => { event.stopPropagation(); onCancel(); }}>
    <div role="dialog" aria-modal="true" aria-label="Linked startup setup" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}
      className="flex max-h-[calc(100vh-32px)] w-[min(640px,calc(100vw-32px))] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="border-b border-zinc-800 px-5 py-3"><h2 className="text-sm font-medium text-zinc-100">Start the API before its clients</h2><p className="mt-1 text-[11px] text-zinc-500">{suggestion.evidence.join(" · ")}</p></div>
      <div className="space-y-4 overflow-y-auto px-5 py-4 text-[12px]">
        <p className="text-zinc-400">Craidd will start {suggestion.serverProjectName}, wait for a successful HTTP response, then launch the selected clients in linked Run or Debug.</p>
        {options("1. Start first", servers, serverNames, setServerNames)}
        <label className="block space-y-1 text-zinc-400"><span>2. Wait for this endpoint</span><input autoFocus disabled={testing} value={readyUrl}
          placeholder={`${suggestion.baseUrl}/your-health-endpoint`} onChange={(event) => { setReadyUrl(event.target.value); setTestMessage(""); }} className={inputClass + " font-mono"} /></label>
        {!suggestion.readyUrl && <p className="text-[11px] text-amber-300">No health route was recognized. Enter an endpoint that returns success when the API is ready.</p>}
        <div className="flex items-center gap-3"><button type="button" disabled={!validUrl || testing} onClick={() => void test()} className="rounded border border-zinc-700 px-2 py-1 text-blue-300 disabled:text-zinc-600">{testing ? "Testing…" : "Test endpoint"}</button><span role="status" className="text-[11px] text-zinc-400">{testMessage}</span></div>
        {options("3. Then start", clients, clientNames, setClientNames)}
        <details className="rounded border border-zinc-800 p-3"><summary className="cursor-pointer text-zinc-400">Advanced: priorities and timeout</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 text-zinc-400">
            <label className="space-y-1">API priority<input type="number" min={1} max={99} value={priority} onChange={(event) => setPriority(Number(event.target.value))} className={inputClass} /></label>
            <label className="space-y-1">Client priority<input type="number" min={2} max={100} value={clientPriority} onChange={(event) => setClientPriority(Number(event.target.value))} className={inputClass} /></label>
            <label className="space-y-1">Wait up to (seconds)<input type="number" min={0.1} max={300} step={0.1} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} className={inputClass} /></label>
            <p className="text-[11px]">Lower priorities start first. Equal priorities start together. API priority must be lower than client priority.</p>
          </div>
        </details>
        <p className="text-[11px] text-zinc-500">Apply adds these settings to your configuration draft. Save writes them to the .cln. Select the customized configurations in the linked windows; other configurations keep their settings.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-[12px] text-zinc-400">Cancel</button>
        <button type="button" disabled={!valid || testing} onClick={() => onApply({ serverNames, clientNames, serverPolicy: { priority, readyUrl, timeoutMs: Math.round(timeoutSeconds * 1000) }, clientPriority })}
          className="rounded bg-blue-700 px-3 py-1.5 text-[12px] text-white hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-500">Apply to selected configurations</button>
      </div>
    </div>
  </div>;
}
