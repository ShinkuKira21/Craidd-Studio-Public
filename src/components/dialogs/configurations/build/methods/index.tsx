import type { ConfigEntry } from "../../../../../types/project";
import CargoFields from "./CargoFields";
import NpmFields from "./NpmFields";
import DotnetFields from "./DotnetFields";
import CmakeFields from "./CmakeFields";
import ShellFields from "./ShellFields";
import ComposedFields from "./ComposedFields";

interface Props {
  config: ConfigEntry;
}

export default function MethodFields({ config }: Props) {
  switch (config.method) {
    case "cargo":
      return <CargoFields config={config} />;
    case "npm":
      return <NpmFields config={config} />;
    case "dotnet":
      return <DotnetFields config={config} />;
    case "cmake":
      return <CmakeFields config={config} />;
    case "shell":
      return <ShellFields config={config} />;
    case "composed":
      return <ComposedFields config={config} />;
    default:
      return (
        <div className="text-[12px] text-zinc-500 italic">
          Unknown method: {config.method ?? "(none)"}
        </div>
      );
  }
}
