import type { ConfigEntry } from "../../../../../types/project";
import MethodFields from "../methods";

export default function MethodSection({ config }: { config: ConfigEntry }) {
  if (!config.method) {
    return (
      <div className="text-[12px] text-zinc-500 italic">
        No method set for this Configuration.
      </div>
    );
  }
  return <MethodFields config={config} />;
}
