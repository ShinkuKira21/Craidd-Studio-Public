import type { ConfigEntry } from "../../../../../types/project";
import { useSolution } from "../../../../../store/solutionStore";
import InheritedField from "../InheritedField";

export default function DotnetFields({ config }: { config: ConfigEntry }) {
  const solution = useSolution((s) => s.solution);
  const project = solution?.projects.find((p) => p.path === config.target);
  const csproj = project?.manifests?.find((m) => m.kind === "dotnet");

  const sdk = (csproj?.values?.sdk as string | undefined) ?? "—";
  const framework = (csproj?.values?.targetFramework as string | undefined) ?? "—";
  const outputType = (csproj?.values?.outputType as string | undefined) ?? "—";
  const isWeb = sdk.includes(".Web");

  return (
    <div className="space-y-2.5">
      <StaticField label="Project"     value={`${project?.name ?? "—"}.csproj`} />
      <StaticField label="SDK"         value={sdk} />
      <StaticField label="Output type" value={outputType} />
      <StaticField label="Framework"   value={framework} />
      <InheritedField
        label="Runtime ID"
        value="linux-x64"
        source="from host"
      />
      {isWeb && (
        <StaticField label="URL" value="https://localhost:5001" />
      )}
      <InheritedField
        label="dotnet"
        value="/usr/bin/dotnet"
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
