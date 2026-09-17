import { memo, useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild } from "../../store/buildStore";

function Toolbar() {
  const solution = useSolution((state) => state.solution);
  const rootPath = useSolution((state) => state.rootPath);
  const projectPath = useBuild((state) => state.projectPath);
  const profile = useBuild((state) => state.profile);
  const status = useBuild((state) => state.status);
  const setProjectPath = useBuild((state) => state.setProjectPath);
  const setProfile = useBuild((state) => state.setProfile);
  const start = useBuild((state) => state.start);
  const stop = useBuild((state) => state.stop);
  const saveDefault = useBuild((state) => state.saveDefault);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const chosen = solution?.defaultProject ?? solution?.projects.find((project) => project.language === "rust")?.path ?? null;
    if (chosen) setProjectPath(chosen);
    setProfile(solution?.defaultBuild === "release" ? "release" : "debug");
  }, [rootPath, solution?.name, solution?.defaultProject, solution?.defaultBuild, setProjectPath, setProfile]);

  const project = solution?.projects.find((item) => item.path === projectPath);
  const canBuild = project?.language === "rust" && !project.missing && status !== "starting" && status !== "running";
  const active = status === "starting" || status === "running";

  const markDefault = async () => {
    setSaveMessage("");
    try { await saveDefault(); setSaveMessage("Default saved"); }
    catch (error) { setSaveMessage(String(error)); }
  };

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-2 shrink-0 text-xs">
      <select aria-label="Project" title="Project" value={projectPath ?? ""} onChange={(event) => setProjectPath(event.target.value)}
        disabled={!solution} className="max-w-[200px] min-w-[120px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200">
        {!projectPath && <option value="">Select project</option>}
        {solution?.projects.map((item) => <option key={item.path} value={item.path}>{item.name}{item.language !== "rust" ? ` (${item.language ?? "config"})` : ""}</option>)}
      </select>
      <select aria-label="Build configuration" title="Build configuration" value={profile} onChange={(event) => setProfile(event.target.value as "debug" | "release")}
        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200">
        <option value="debug">Cargo Debug</option>
        <option value="release">Cargo Release</option>
      </select>
      <button onClick={() => void markDefault()} disabled={!solution || !projectPath}
        title="Save the selected project and build configuration in the solution"
        className="px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40">Set as default</button>
      <div className="w-px h-5 bg-zinc-700 mx-1" />
      <button onClick={() => void start("build")} disabled={!canBuild}
        className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:bg-zinc-800 disabled:text-zinc-500">Build</button>
      <button onClick={() => void start("run")} disabled={!canBuild}
        className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:text-zinc-500">▶ Run</button>
      <button onClick={() => void stop()} disabled={!active}
        className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:text-zinc-600">■ Stop</button>
      <button disabled title="Rust debugger arrives after the Cargo build path" className="px-3 py-1 rounded text-zinc-600">Debug</button>
      <span className="ml-auto max-w-[180px] truncate text-zinc-500" title={saveMessage || status}>{saveMessage || status}</span>
    </div>
  );
}

export default memo(Toolbar);
