import type { ConfigEntry, OrderStep } from "../../../types/project";

const inputClass = "w-full min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12px] text-zinc-100 disabled:text-zinc-600";

export default function BuildOrderEditor({ config, configs, editable, onChange }: {
  config: ConfigEntry; configs: ConfigEntry[]; editable: boolean; onChange: (config: ConfigEntry) => void;
}) {
  const steps = config.order?.steps ?? [];
  const builds = configs.filter((item) => item.origin === "user" && item.kind === "build" && !item.slots && item.name !== config.name);
  const native = builds.filter((item) => item.method === "cmake");
  const managed = builds.filter((item) => item.method === "dotnet");
  const setSteps = (steps: OrderStep[]) => onChange({ ...config, order: { steps } });
  const update = (index: number, step: OrderStep) => setSteps(steps.map((value, position) => position === index ? step : value));
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setSteps(next);
  };
  const select = (label: string, value: string, choices: ConfigEntry[], change: (value: string) => void) =>
    <label className="block space-y-1 text-[11px] text-zinc-400"><span>{label}</span><select aria-label={label} disabled={!editable} value={value}
      onChange={(event) => change(event.target.value)} className={inputClass}><option value="">Choose configuration…</option>
      {choices.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>;
  return <section className="space-y-3 rounded border border-blue-900/60 bg-blue-950/10 p-3">
    <h3 className="text-sm text-zinc-200">Build order</h3>
    <p className="text-[11px] text-zinc-400">Each step waits for success. A failure or cancellation prevents later steps from starting.</p>
    <ol className="space-y-2">{steps.map((step, index) => <li key={index} className="rounded border border-zinc-700 bg-zinc-900 p-3">
      <div className="mb-2 flex items-center gap-2"><span className="text-[12px] text-blue-300">{index + 1}. {step.kind === "build" ? "Build" : "Install native artifacts"}</span>
        <div className="ml-auto flex gap-2 text-[11px] text-zinc-400">
          <button type="button" aria-label={`Move step ${index + 1} earlier`} disabled={!editable || index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`Move step ${index + 1} later`} disabled={!editable || index === steps.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" disabled={!editable} onClick={() => setSteps(steps.filter((_, position) => position !== index))}>Remove</button>
        </div>
      </div>
      {select(`Step ${index + 1} configuration`, step.configuration, step.kind === "install" ? native : builds,
        (configuration) => update(index, { ...step, configuration }))}
      {step.kind === "install" && <div className="mt-2 space-y-2">
        {select(`Step ${index + 1} destination`, step.destination, managed, (destination) => update(index, { ...step, destination }))}
        <p className="text-[11px] text-zinc-500">Destination: the selected .NET build's resolved output directory. Both builds must occur earlier. CMake owns which artifacts are installed; originals remain in its build directory.</p>
      </div>}
    </li>)}</ol>
    {steps.length === 0 && <p className="text-[12px] text-zinc-500">Add the first build step below.</p>}
    <div className="flex gap-3 text-[12px] text-blue-400">
      <button type="button" disabled={!editable || builds.length === 0} onClick={() => setSteps([...steps, { kind: "build", configuration: builds[0]?.name ?? "" }])}>+ Build configuration</button>
      <button type="button" disabled={!editable || native.length === 0 || managed.length === 0} onClick={() => setSteps([...steps, { kind: "install", configuration: native[0]?.name ?? "", destination: managed[0]?.name ?? "" }])}>+ Install artifacts</button>
    </div>
  </section>;
}
