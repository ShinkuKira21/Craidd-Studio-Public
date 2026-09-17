import { useState } from "react";
import SectionRail, { type SectionId } from "./SectionRail";
import BuildSection from "./build/BuildSection";

interface Props {
  onClose: () => void;
}

export default function ConfigurationsDialog({ onClose }: Props) {
  const [section, setSection] = useState<SectionId>("build");

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[1040px] h-[680px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 shrink-0">
          <span className="text-sm text-zinc-100 font-medium">Configurations</span>
          <span className="text-[11px] text-zinc-500">
            What the IDE sees, and how this solution runs
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body: rail + content */}
        <div className="flex-1 min-h-0 flex">
          <SectionRail section={section} onSelect={setSection} />
          <div className="flex-1 min-w-0 flex flex-col">
            {section === "build" && <BuildSection />}
            {section !== "build" && (
              <div className="flex-1 flex items-center justify-center text-[12px] text-zinc-600 italic">
                {section} — coming in a later push
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
