import type { ConfigEntry } from "../../../../../types/project";
import { useSolution } from "../../../../../store/solutionStore";
import InheritedField from "../InheritedField";

export default function CargoFields({ config }: { config: ConfigEntry }) {
  const solution = useSolution((s) => s.solution);
  const project = solution?.projects.find((p) => p.path === config.target);
  const cargo = project?.manifests?.find((m) => m.kind === "cargo");

  const packageName = (cargo?.values?.packageName as string | undefined) ?? project?.name ?? "—";
  const bins = (cargo?.values?.bins as unknown[] | undefined) ?? [];
  const binName = (bins[0] as string | undefined) ?? "(auto-detected)";
  const edition = (cargo?.values?.edition as string | undefined) ?? "—";

  return (
    <div className="space-y-2.5">
      <StaticField label="Package"    value={packageName} />
      <StaticField label="Bin"        value={binName} />
      <StaticField label="Edition"    value={edition} />
      <StaticField label="Features"   value="—" />
      <StaticField label="Target"     value="(host)" />
      <InheritedField
        label="Cargo"
        value="~/.cargo/bin/cargo"
        source="from preferences"
      />
      <InheritedField
        label="Rustc"
        value="~/.cargo/bin/rustc"
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
