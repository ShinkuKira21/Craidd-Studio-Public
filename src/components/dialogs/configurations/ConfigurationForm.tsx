import type { ConfigEntry, ConfigKind, CraiddProject, Profile } from "../../../types/project";
import { choicesForConfig } from "../../../store/buildStore";
import type { CraiddSolution } from "../../../types/project";

interface Props {
  config: ConfigEntry;
  projects: CraiddProject[];
  allConfigs: ConfigEntry[];
  solution: CraiddSolution;
  editable: boolean;
  onChange: (next: ConfigEntry) => void;
}

const inputClass = "w-full min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-blue-500 disabled:border-zinc-800 disabled:text-zinc-500";
const kinds: ConfigKind[] = ["run", "build", "debug", "test"];
const methods = ["cargo", "npm", "shell", "dotnet", "cmake", "python", "composed"];

export default function ConfigurationForm({ config, projects, allConfigs, solution, editable, onChange }: Props) {
  const isComposition = !!config.slots || config.bestFit === true;
  const inferredSlots = config.bestFit ? choicesForConfig(solution, config) : null;
  const slots = config.slots ?? inferredSlots;
  const set = (patch: Partial<ConfigEntry>) => onChange({ ...config, ...patch });
  const profiles = config.profiles ?? [];
  const updateProfile = (index: number, patch: Partial<Profile>) => {
    const next = profiles.map((profile, i) => i === index ? { ...profile, ...patch } : profile);
    set({ profiles: next });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
      <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
        <h2 className="text-sm text-zinc-100 font-medium truncate">{config.name || "New configuration"}</h2>
        <span className="text-[10px] uppercase text-zinc-500 border border-zinc-700 rounded px-1.5">{isComposition ? "power" : config.kind}</span>
        {config.origin === "inferred" && <span className="text-[10px] text-zinc-500 ml-auto">Inferred · customize to edit</span>}
      </div>
      <div className="px-5 py-4 space-y-3 max-w-[680px]">
        <Field label="Name"><input className={inputClass} value={config.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} /></Field>
        {isComposition ? (
          <>
            <p className="text-[11px] text-zinc-500">Choose the configuration each toolbar action uses. Empty slots disable that action.</p>
            {(["run", "build", "debug"] as const).map((kind) => {
              const current = slots?.[kind] ?? "";
              const candidates = allConfigs.filter((candidate) => !candidate.slots && candidate.kind === kind);
              return <Field key={kind} label={kind[0].toUpperCase() + kind.slice(1)}>
                <select className={inputClass} value={current} disabled={!editable} onChange={(e) => set({ slots: { ...config.slots, [kind]: e.target.value || undefined } })}>
                  <option value="">No {kind} action</option>
                  {candidates.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name} · {projects.find((p) => p.path === candidate.target)?.name ?? "workspace"}</option>)}
                </select>
              </Field>;
            })}
          </>
        ) : (
          <>
            <Field label="Kind"><select className={inputClass} value={config.kind} disabled={!editable} onChange={(e) => set({ kind: e.target.value as ConfigKind })}>{kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></Field>
            <Field label="Project"><select className={inputClass} value={config.target} disabled={!editable} onChange={(e) => set({ target: e.target.value })}><option value=".">Whole solution</option>{projects.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}</select></Field>
            <Field label="Method"><select className={inputClass} value={config.method ?? ""} disabled={!editable} onChange={(e) => set({ method: e.target.value || undefined })}><option value="">Automatic</option>{methods.map((method) => <option key={method} value={method}>{method}</option>)}</select></Field>
            <Field label="Command"><input className={inputClass + " font-mono"} value={config.command ?? ""} disabled={!editable} placeholder="Derived from method when empty" onChange={(e) => set({ command: e.target.value || undefined })} /></Field>
            <Field label="Working directory"><input className={inputClass + " font-mono"} value={config.cwd ?? ""} disabled={!editable} placeholder="Project folder when empty" onChange={(e) => set({ cwd: e.target.value || undefined })} /></Field>
            <div className="pt-3 border-t border-zinc-800">
              <div className="flex items-center gap-2 mb-3"><span className="text-[11px] uppercase tracking-wide text-zinc-500">Profiles</span><button type="button" disabled={!editable} className="ml-auto text-[11px] text-blue-400 disabled:text-zinc-700" onClick={() => set({ profiles: [...profiles, { name: `Profile ${profiles.length + 1}`, args: [], env: {} }] })}>+ Add profile</button></div>
              {profiles.length === 0 && <p className="text-[11px] text-zinc-600">No profiles. The command runs with its default arguments.</p>}
              {profiles.map((profile, index) => <div key={index} className="border border-zinc-800 rounded p-3 mb-2 space-y-2">
                <div className="flex gap-2"><input aria-label="Profile name" className={inputClass} value={profile.name} disabled={!editable} onChange={(e) => { const name = e.target.value; set({ profiles: profiles.map((item, i) => i === index ? { ...item, name } : item), defaultProfile: config.defaultProfile === profile.name ? name : config.defaultProfile }); }} /><button type="button" disabled={!editable} className="text-[11px] text-red-400 disabled:text-zinc-700" onClick={() => set({ profiles: profiles.filter((_, i) => i !== index), defaultProfile: config.defaultProfile === profile.name ? undefined : config.defaultProfile })}>Remove</button></div>
                <label className="flex items-center gap-2 text-[11px] text-zinc-400"><input type="radio" name="default-profile" checked={config.defaultProfile === profile.name} disabled={!editable} onChange={() => set({ defaultProfile: profile.name })} /> Default profile</label>
                <div className="space-y-1"><div className="text-[11px] text-zinc-500">Arguments</div>{profile.args.map((arg, argIndex) => <div key={argIndex} className="flex gap-1"><input aria-label={`Argument ${argIndex + 1}`} className={inputClass + " font-mono"} value={arg} disabled={!editable} onChange={(e) => updateProfile(index, { args: profile.args.map((item, i) => i === argIndex ? e.target.value : item) })} /><button type="button" disabled={!editable} className="text-zinc-500 disabled:text-zinc-700" onClick={() => updateProfile(index, { args: profile.args.filter((_, i) => i !== argIndex) })}>×</button></div>)}<button type="button" disabled={!editable} className="text-[11px] text-blue-400 disabled:text-zinc-700" onClick={() => updateProfile(index, { args: [...profile.args, ""] })}>+ Argument</button></div>
                <div className="space-y-1"><div className="text-[11px] text-zinc-500">Environment</div>{Object.entries(profile.env).map(([key, value], envIndex) => <div key={envIndex} className="flex gap-1"><input aria-label={`Variable name ${envIndex + 1}`} className={inputClass + " font-mono"} value={key} disabled={!editable} placeholder="KEY" onChange={(e) => { const pairs = Object.entries(profile.env); if (pairs.some(([name], i) => i !== envIndex && name === e.target.value)) return; pairs[envIndex] = [e.target.value, value]; updateProfile(index, { env: Object.fromEntries(pairs) }); }} /><input aria-label={`Variable value ${envIndex + 1}`} className={inputClass + " font-mono"} value={value} disabled={!editable} placeholder="Value" onChange={(e) => updateProfile(index, { env: { ...profile.env, [key]: e.target.value } })} /><button type="button" disabled={!editable} className="text-zinc-500 disabled:text-zinc-700" onClick={() => { const pairs = Object.entries(profile.env).filter((_, i) => i !== envIndex); updateProfile(index, { env: Object.fromEntries(pairs) }); }}>×</button></div>)}<button type="button" disabled={!editable || Object.prototype.hasOwnProperty.call(profile.env, "")} className="text-[11px] text-blue-400 disabled:text-zinc-700" onClick={() => updateProfile(index, { env: { ...profile.env, "": "" } })}>+ Variable</button></div>
              </div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid grid-cols-[116px_minmax(0,1fr)] max-[500px]:grid-cols-1 gap-2 items-center text-[12px]"><span className="text-zinc-400">{label}</span><div className="min-w-0">{children}</div></label>;
}
