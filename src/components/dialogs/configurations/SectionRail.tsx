export type SectionId = "identity" | "membership" | "toolchain" | "build";

interface Props {
  section: SectionId;
  onSelect: (id: SectionId) => void;
}

const SECTIONS: { id: SectionId; label: string; enabled: boolean }[] = [
  { id: "identity", label: "Identity", enabled: false },
  { id: "membership", label: "Membership", enabled: false },
  { id: "toolchain", label: "Toolchain", enabled: false },
  { id: "build", label: "Build", enabled: true },
];

export default function SectionRail({ section, onSelect }: Props) {
  return (
    <div className="w-44 shrink-0 border-r border-zinc-800 py-3">
      {SECTIONS.map((s) => {
        const active = section === s.id;
        return (
          <button
            key={s.id}
            disabled={!s.enabled}
            onClick={() => s.enabled && onSelect(s.id)}
            className={
              "w-full text-left px-4 py-1.5 text-[12.5px] transition-colors " +
              (active
                ? "bg-zinc-800 text-zinc-100 border-l-2 border-l-blue-500"
                : s.enabled
                ? "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 border-l-2 border-l-transparent"
                : "text-zinc-600 cursor-default border-l-2 border-l-transparent")
            }
          >
            {s.label}
            {!s.enabled && (
              <span className="ml-2 text-[10px] text-zinc-700">soon</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
