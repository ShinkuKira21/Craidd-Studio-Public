export type SectionId = "identity" | "membership" | "toolchain" | "build";

type Section = { id: SectionId; label: string; available: boolean };

const groups: { heading: string; sections: Section[] }[] = [
  { heading: "Workspace", sections: [
    { id: "identity", label: "Identity", available: false },
    { id: "membership", label: "Membership", available: false },
    { id: "toolchain", label: "Project Toolchain", available: true },
  ] },
  { heading: "Execution", sections: [
    { id: "build", label: "Build Configuration", available: true },
  ] },
];

export default function SectionRail({ active, onSelect, buildDirty }: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  buildDirty: boolean;
}) {
  return <nav aria-label="Workspace configuration sections" className="w-44 shrink-0 border-r border-zinc-800 overflow-y-auto scroll-thin py-2 max-[850px]:w-full max-[850px]:border-r-0 max-[850px]:border-b max-[850px]:flex max-[850px]:overflow-x-auto max-[850px]:py-1">
    {groups.map((group) => <div key={group.heading} className="max-[850px]:flex max-[850px]:items-center max-[850px]:shrink-0">
      <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 max-[850px]:hidden">{group.heading}</div>
      {group.sections.map((section) => <button
        key={section.id}
        type="button"
        disabled={!section.available}
        aria-current={active === section.id ? "page" : undefined}
        title={section.available ? section.label : `${section.label} is planned for this dialog`}
        onClick={() => onSelect(section.id)}
        className={"w-full min-h-8 flex items-center gap-1.5 px-4 py-1.5 text-left text-[12px] border-l-2 max-[850px]:w-auto max-[850px]:shrink-0 max-[850px]:border-l-0 max-[850px]:border-b-2 " +
          (active === section.id ? "border-blue-500 bg-zinc-800 text-zinc-100" : section.available ? "border-transparent text-zinc-300 hover:bg-zinc-800" : "border-transparent text-zinc-600 cursor-default")}
      >
        <span className="truncate">{section.label}</span>
        {section.id === "build" && buildDirty && <span aria-label="Unsaved changes" title="Unsaved changes" className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
        {!section.available && <span className="text-[9px] text-zinc-600 ml-auto max-[850px]:hidden">soon</span>}
      </button>)}
    </div>)}
  </nav>;
}
