import type { ConfigEntry } from "../../../../../types/project";
import { useSolution } from "../../../../../store/solutionStore";

export default function DotnetFields({ config }: { config: ConfigEntry }) {
  const solution = useSolution((s) => s.solution);
  const project = solution?.projects.find((p) => p.path === config.target);
  const csproj = project?.manifests?.find((m) => m.kind === "dotnet");

  const sdk = (csproj?.values?.sdk as string | undefined) ?? "—";
  const framework = (csproj?.values?.targetFramework as string | undefined) ?? "—";
  const outputType = (csproj?.values?.outputType as string | undefined) ?? "—";
  const platformTarget = (csproj?.values?.platformTarget as string | undefined) ?? "AnyCPU (default)";
  const runtimeId = (csproj?.values?.runtimeIdentifier as string | undefined) ?? "Portable (default)";
  const platforms = csproj?.values?.platforms as string | undefined;
  const isWeb = sdk.includes(".Web");

  return (
    <div className="space-y-2.5">
      <StaticField label="Project"     value={csproj?.path.split(/[\\/]/).pop() ?? "—"} />
      <StaticField label="SDK"         value={sdk} />
      <StaticField label="Output type" value={isWeb && outputType === "—" ? "Exe (Web SDK default)" : outputType} />
      <StaticField label="Framework"   value={framework} />
      {platforms && <StaticField label="Platforms" value={platforms} />}
      <StaticField label="Platform target" value={platformTarget} />
      <StaticField label="Runtime ID" value={runtimeId} />
      {isWeb && (
        <StaticField label="URL" value="See run output" />
      )}
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
