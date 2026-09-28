import type { ConfigEntry } from "../../../../../types/project";
import { useSolution } from "../../../../../store/solutionStore";
import InheritedField from "../InheritedField";

export default function CmakeFields({ config }: { config: ConfigEntry }) {
  const solution = useSolution((s) => s.solution);
  const project = solution?.projects.find((p) => p.path === config.target);
  const cmake = project?.manifests?.find((m) => m.kind === "cmake");

  const projectName = (cmake?.values?.projectName as string | undefined) ?? "—";
  const standard    = (cmake?.values?.cxxStandard as string | undefined) ?? "—";
  const executables = (cmake?.values?.executables as string[] | undefined) ?? [];
  const libraries   = (cmake?.values?.libraries as string[] | undefined) ?? [];

  const isLibraryOnly = executables.length === 0 && libraries.length > 0;

  return (
    <div className="space-y-2.5">
      <StaticField label="CMake project" value={projectName} />
      <StaticField label="Source dir"    value="." />
      <StaticField label="Build dir"     value="build" />
      <InheritedField
        label="Generator"
        value="Ninja"
        source="from preferences"
      />
      <InheritedField
        label="C++ std"
        value={standard}
        source="from CMakeLists.txt"
      />

      {executables.length > 0 && (
        <StaticField label="Executables" value={executables.join(", ")} />
      )}
      {libraries.length > 0 && (
        <StaticField label="Libraries" value={libraries.join(", ")} />
      )}

      {isLibraryOnly && (
        <div className="mt-1 text-[11px] text-zinc-500 leading-4 pl-28">
          This is a library with no entry point. To debug it, add a driver
          project.
        </div>
      )}

      <InheritedField
        label="CMake"
        value="/usr/bin/cmake"
        source="from preferences"
      />
    </div>
  );
}

function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-zinc-400">{label}</span>
      <div className="flex-1 min-w-0">
        <input
          value={value}
          readOnly
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300"
        />
      </div>
    </div>
  );
}
