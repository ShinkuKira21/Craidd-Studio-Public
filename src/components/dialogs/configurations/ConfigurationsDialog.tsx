import { useMemo, useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import { choicesForConfig, selectConfiguration } from "../../../store/buildStore";
import type { ConfigEntry } from "../../../types/project";
import ConfigurationForm from "./ConfigurationForm";
import SectionRail, { type SectionId } from "./SectionRail";
import ToolchainConfigurationDialog from "../ToolchainConfigurationDialog";

interface Props { onClose: () => void; }
type Row = { key: string; entry?: ConfigEntry; label?: string };
const actionClass = "px-2 py-1 rounded text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:text-zinc-700 disabled:cursor-default";
const clone = (entry: ConfigEntry): ConfigEntry => ({ ...entry, slots: entry.slots ? { ...entry.slots } : undefined, profiles: entry.profiles?.map((p) => ({ ...p, args: [...p.args], env: { ...p.env } })) ?? [] });

export default function ConfigurationsDialog({ onClose }: Props) {
  const solution = useSolution((s) => s.solution);
  const saveConfigurations = useSolution((s) => s.saveConfigurations);
  const [section, setSection] = useState<SectionId>("build");
  const [toolchainProjectPath, setToolchainProjectPath] = useState<string | null>(null);
  const [toolchainDirty, setToolchainDirty] = useState(false);
  const [toolchainSaved, setToolchainSaved] = useState(false);
  const [drafts, setDrafts] = useState<ConfigEntry[]>(() => solution?.configs.map(clone) ?? []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [defaultName, setDefaultName] = useState<string | undefined>(solution?.defaultConfig);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = solution?.projects ?? [];
  const toolchainProject = projects.find((project) => project.path === toolchainProjectPath) ?? projects[0];
  const inferred = solution?.inferredConfigs ?? [];
  const allConfigs = [...inferred, ...drafts];
  const displayEntries = [
    ...inferred.filter((entry) => !entry.bestFit || entry.kind === "run").map((entry) => ({ key: `i:${entry.name}`, entry })),
    ...drafts.map((entry, index) => ({ key: `u:${index}`, entry })),
  ];
  const rows: Row[] = useMemo(() => {
    const result: Row[] = [];
    const addGroup = (label: string, entries: typeof displayEntries) => {
      if (!entries.length) return;
      result.push({ key: `header:${label}`, label });
      result.push(...entries);
    };
    addGroup("Power configurations", displayEntries.filter((row) => row.entry.bestFit || row.entry.slots));
    for (const project of projects) addGroup(project.name, displayEntries.filter((row) => !row.entry.bestFit && !row.entry.slots && row.entry.target === project.path));
    addGroup("Workspace commands", displayEntries.filter((row) => !row.entry.bestFit && !row.entry.slots && row.entry.target === "."));
    addGroup("Unmatched targets", displayEntries.filter((row) => !row.entry.bestFit && !row.entry.slots && row.entry.target !== "." && !projects.some((p) => p.path === row.entry.target)));
    return result;
  }, [solution, drafts]);
  const selectedRow = displayEntries.find((row) => row.key === selectedKey) ?? displayEntries[0];
  const selected = selectedRow?.entry;
  const userIndex = selectedRow?.key.startsWith("u:") ? Number(selectedRow.key.slice(2)) : -1;
  const editable = userIndex >= 0;
  const uniqueName = (base: string) => {
    const names = new Set(allConfigs.map((entry) => entry.name.toLowerCase()));
    let name = base; let count = 2;
    while (names.has(name.toLowerCase())) name = `${base} ${count++}`;
    return name;
  };
  const markDirty = () => { setDirty(true); setError(null); };
  const append = (entry: ConfigEntry) => {
    setDrafts((previous) => [...previous, entry]);
    setSelectedKey(`u:${drafts.length}`);
    markDirty();
  };
  const addProject = () => append({ name: uniqueName("New Configuration"), kind: "run", target: projects[0]?.path ?? ".", method: "shell", command: "", origin: "user", profiles: [] });
  const addComposition = () => append({ name: uniqueName("New Power Configuration"), kind: "run", target: ".", origin: "user", slots: {}, profiles: [] });
  const duplicate = () => {
    if (!selected || !solution) return;
    if (selected.bestFit) {
      const slots = choicesForConfig(solution, selected);
      append({ name: uniqueName(`${selected.name} Custom`), kind: "run", target: ".", origin: "user", slots: { build: slots.build ?? undefined, run: slots.run ?? undefined, debug: slots.debug ?? undefined }, profiles: [] });
    } else {
      const copy = clone(selected);
      copy.name = uniqueName(`${selected.name} Copy`);
      copy.origin = "user";
      copy.bestFit = false;
      copy.relatedProjects = [];
      append(copy);
    }
  };
  const change = (next: ConfigEntry) => {
    if (userIndex < 0) return;
    const oldName = drafts[userIndex].name;
    setDrafts((previous) => previous.map((entry, index) => index === userIndex ? next : entry));
    if (defaultName === oldName) setDefaultName(next.name);
    markDirty();
  };
  const remove = () => {
    if (userIndex < 0 || !selected) return;
    setDrafts((previous) => previous.filter((_, index) => index !== userIndex));
    if (defaultName === selected.name) setDefaultName(undefined);
    setSelectedKey(null);
    markDirty();
  };
  const close = () => {
    if (!saving && (!(dirty || toolchainDirty) || window.confirm("Discard unsaved configuration changes?"))) onClose();
  };
  const selectSection = (next: SectionId) => {
    if (section === "toolchain" && next !== "toolchain" && toolchainDirty && !window.confirm("Discard unsaved toolchain changes?")) return;
    if (next !== "toolchain") setToolchainDirty(false);
    if (next === "toolchain" && section !== "toolchain") setToolchainSaved(false);
    setSection(next);
  };
  const selectToolchainProject = (path: string) => {
    if (toolchainDirty && !window.confirm("Discard unsaved toolchain changes?")) return;
    setToolchainDirty(false);
    setToolchainSaved(false);
    setToolchainProjectPath(path);
  };
  const validate = (): string | null => {
    const names = new Set(inferred.map((entry) => entry.name.toLowerCase()));
    for (const entry of drafts) {
      const name = entry.name.trim();
      if (!name) return "Every configuration needs a name.";
      if (entry.name !== name) return `${name}: remove leading or trailing spaces from the name.`;
      if (names.has(name.toLowerCase())) return `Duplicate configuration name: ${name}`;
      names.add(name.toLowerCase());
      if (!entry.slots && entry.target !== "." && !projects.some((project) => project.path === entry.target)) return `${name}: choose an existing project.`;
      if (entry.slots) {
        if (!entry.slots.run && !entry.slots.build && !entry.slots.debug) return `${name}: choose at least one action slot.`;
        for (const kind of ["run", "build", "debug"] as const) {
          const ref = entry.slots[kind];
          if (ref && !allConfigs.some((candidate) => candidate.name === ref && candidate.kind === kind && !candidate.slots)) return `${name}: ${kind} references a missing configuration.`;
        }
      } else {
        const derived = entry.method === "cargo" || entry.method === "dotnet"
          || (entry.method === "cmake" && (entry.kind === "build" || entry.kind === "debug"));
        if (!entry.command?.trim() && !derived) return `${name}: add an executable command.`;
        if (entry.kind === "debug" && !["cargo", "dotnet", "cmake"].includes(entry.method ?? "")) return `${name}: debugging requires a Cargo, .NET, or CMake configuration.`;
        if (entry.cwd && (entry.cwd.startsWith("/") || entry.cwd.split(/[\\/]/).includes(".."))) return `${name}: working directory must stay inside the solution.`;
      }
      const profileNames = new Set<string>();
      for (const profile of entry.profiles ?? []) {
        if (!profile.name.trim() || profile.name !== profile.name.trim() || profileNames.has(profile.name.toLowerCase())) return `${name}: profile names must be trimmed and unique.`;
        profileNames.add(profile.name.toLowerCase());
        if (profile.args.some((arg) => !arg.trim())) return `${name}: remove or fill empty arguments.`;
        if (Object.keys(profile.env).some((key) => !key.trim() || key.includes("="))) return `${name}: environment variable names must be filled in.`;
      }
      if (entry.defaultProfile && !profileNames.has(entry.defaultProfile.toLowerCase())) return `${name}: default profile is missing.`;
    }
    if (defaultName && !allConfigs.some((entry) => entry.name === defaultName)) return "The default configuration no longer exists.";
    return null;
  };
  const save = async () => {
    const message = validate();
    if (message) { setError(message); return; }
    setSaving(true); setError(null);
    try {
      await saveConfigurations(drafts.map(clone), defaultName);
      const nextSolution = useSolution.getState().solution;
      if (selected && nextSolution && allConfigs.some((entry) => entry.name === selected.name)) selectConfiguration(nextSolution, selected.name);
      setDirty(false); onClose();
    } catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60" onClick={close}>
    <div role="dialog" aria-modal="true" aria-label="Configurations" onClick={(event) => event.stopPropagation()} className="w-[min(980px,calc(100vw-32px))] h-[min(680px,calc(100vh-32px))] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 shrink-0"><span className="text-sm text-zinc-100 font-medium">Configurations</span><span className="text-[11px] text-zinc-500 max-[700px]:hidden">Inferred starting points and your saved configurations</span><button type="button" aria-label="Close" className="ml-auto text-zinc-400 hover:text-white" onClick={close}>×</button></div>
      <div className="flex-1 min-h-0 flex max-[850px]:flex-col">
        <SectionRail active={section} onSelect={selectSection} buildDirty={dirty} />
        {section === "build" ? <div className="flex-1 min-w-0 min-h-0 flex max-[700px]:flex-col">
        <div className="w-[260px] shrink-0 border-r border-zinc-800 flex flex-col min-h-0 max-[700px]:w-full max-[700px]:h-[35%] max-[700px]:border-r-0 max-[700px]:border-b">
          <div className="px-2 py-2 border-b border-zinc-800 flex gap-1"><button type="button" className={actionClass} onClick={addProject}>+ Configuration</button><button type="button" className={actionClass} onClick={addComposition} title="Choose Build, Run, and Debug configurations for one toolbar preset">+ Power</button></div>
          <div className="flex-1 overflow-y-auto scroll-thin py-2">{rows.length === 0 && <p className="px-4 text-[12px] text-zinc-500">No configurations yet. Create one above.</p>}{rows.map((row) => row.label ? <div key={row.key} className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">{row.label}</div> : <button key={row.key} type="button" onClick={() => setSelectedKey(row.key)} className={"w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] border-l-2 " + (selectedRow?.key === row.key ? "border-blue-500 bg-blue-950/40 text-zinc-100" : "border-transparent text-zinc-300 hover:bg-zinc-800")}><span className="truncate flex-1">{row.entry?.name}</span>{row.entry?.origin === "inferred" && <span className="text-[9px] text-zinc-500">auto</span>}{row.entry?.name === defaultName && <span title="Default" className="text-amber-400">★</span>}</button>)}</div>
          <div className="px-2 py-2 border-t border-zinc-800 flex gap-1 flex-wrap"><button type="button" disabled={!selected} className={actionClass} onClick={duplicate}>{editable ? "Duplicate" : "Customize"}</button><button type="button" disabled={!editable} className={actionClass} onClick={remove}>Delete</button><button type="button" disabled={!selected || selected.name === defaultName} className={actionClass} onClick={() => { setDefaultName(selected?.name); markDirty(); }}>Set default</button></div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col">{selected && solution ? <ConfigurationForm config={selected} projects={projects} allConfigs={allConfigs} solution={solution} editable={editable} onChange={change} /> : <div className="flex-1 flex items-center justify-center text-[12px] text-zinc-500">Select or create a configuration.</div>}</div>
        </div> : section === "toolchain" ? <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 text-[12px] text-zinc-400">
            <label htmlFor="configuration-toolchain-project">Project</label>
            <select id="configuration-toolchain-project" value={toolchainProject?.path ?? ""} onChange={(event) => selectToolchainProject(event.target.value)} className="min-w-0 max-w-[280px] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200">
              {projects.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}
            </select>
            {toolchainSaved && <span role="status" className="text-green-400">Saved</span>}
          </div>
          {toolchainProject ? <ToolchainConfigurationDialog key={toolchainProject.path} embedded project={toolchainProject} onDirtyChange={(value) => { setToolchainDirty(value); if (value) setToolchainSaved(false); }} onSaved={() => { setToolchainDirty(false); setToolchainSaved(true); }} onClose={() => { if (toolchainDirty && !window.confirm("Discard unsaved toolchain changes?")) return; setToolchainDirty(false); setSection("build"); }} /> : <div className="flex-1 flex items-center justify-center text-[12px] text-zinc-500">Add a project to configure its toolchain.</div>}
        </div> : <div className="flex-1 min-w-0 flex items-center justify-center px-6 text-center text-[12px] text-zinc-500">This workspace section is planned; the Build Configuration editor remains available.</div>}
      </div>
      {section === "build" && <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-2 min-h-11"><span role="alert" className="text-[11px] text-red-400 truncate flex-1" title={error ?? undefined}>{error ?? (dirty ? "Unsaved changes" : "")}</span><button type="button" onClick={close} className={actionClass}>Cancel</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="px-3 py-1.5 rounded bg-blue-700 text-white text-[12px] hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-500">{saving ? "Saving…" : "Save"}</button></div>}
    </div>
  </div>;
}
