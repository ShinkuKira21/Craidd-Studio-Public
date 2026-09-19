import type { ConfigEntry, Profile } from "../../../../../types/project";
import { useBuild } from "../../../../../store/buildStore";

export default function CommonSection({ config }: { config: ConfigEntry }) {
  const profiles = config.profiles ?? [];
  const hasProfiles = profiles.length > 0;
  const selectedProfileName = useBuild((state) => state.selectedProfileName);
  const setSelectedProfile = useBuild((state) => state.setSelectedProfile);
  const selected = profiles.find((p) => p.name === selectedProfileName)?.name
    ?? profiles.find((p) => p.name === config.defaultProfile)?.name
    ?? profiles[0]?.name
    ?? "";

  const current: Profile | undefined =
    profiles.find((p) => p.name === selected) ?? profiles[0];

  return (
    <div className="space-y-2.5">
      <Row label="Profile">
        {hasProfiles ? (
          <select
            value={selected}
            onChange={(e) => setSelectedProfile(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300 focus:border-blue-500 outline-none"
          >
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.description ? ` — ${p.description}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-[12px] text-zinc-500 italic">
            (this method has no profiles)
          </div>
        )}
      </Row>

      <Row label="Args">
        <TextareaValue
          placeholder="one argument per line"
          value={current?.args?.join("\n") ?? ""}
          dim={!hasProfiles}
        />
      </Row>

      <Row label="Env">
        <TextareaValue
          placeholder="KEY=VALUE per line"
          value={
            current
              ? Object.entries(current.env ?? {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join("\n")
              : ""
          }
          dim={!hasProfiles}
        />
      </Row>
    </div>
  );
}

function TextareaValue({
  value,
  placeholder,
  dim,
}: {
  value: string;
  placeholder: string;
  dim?: boolean;
}) {
  return (
    <textarea
      value={value}
      readOnly
      rows={3}
      placeholder={placeholder}
      className={
        "w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] font-mono resize-none scroll-thin placeholder:text-zinc-700 " +
        (dim ? "text-zinc-500" : "text-zinc-300")
      }
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 text-[12px] text-zinc-400 pt-1">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
