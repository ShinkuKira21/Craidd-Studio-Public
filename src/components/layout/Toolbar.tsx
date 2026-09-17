import { memo, useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild } from "../../store/buildStore";
import ConfigurationsDialog from "../dialogs/configurations/ConfigurationsDialog";

function Toolbar() {
  const solution = useSolution((s) => s.solution);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const setSelectedConfig = useBuild((s) => s.setSelectedConfig);
  const status = useBuild((s) => s.status);
  const [dialogOpen, setDialogOpen] = useState(false);

  // All configurations visible to the toolbar: inferred + user.
  const configs = [
    ...(solution?.inferredConfigs ?? []),
    ...(solution?.configs ?? []),
  ];

  // If nothing is selected, default to the first available entry.
  useEffect(() => {
    if (!selectedConfigName && configs.length > 0) {
      setSelectedConfig(configs[0].name);
    }
  }, [solution, selectedConfigName, configs, setSelectedConfig]);

  const selected = configs.find((c) => c.name === selectedConfigName) ?? null;
  const hasSolution = !!solution;
  const active = status === "starting" || status === "running";

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-1.5 shrink-0 text-xs">
      <IconButton
        title="Build (Ctrl+Shift+B)"
        icon="🔨"
        disabled={!hasSolution || active || !selected}
      />

      <ConfigChip
        hasSolution={hasSolution}
        configs={configs}
        selectedName={selected?.name ?? null}
        onSelect={(name) => setSelectedConfig(name)}
        onOpenDialog={() => setDialogOpen(true)}
      />

      <IconButton
        title="Run (Ctrl+F5)"
        icon="▶"
        disabled={!hasSolution || active || !selected}
      />
      <IconButton
        title="Stop (Shift+F5)"
        icon="⏹"
        disabled={!active}
      />
      <IconButton
        title="Debug (F5) — arrives in Phase 3"
        icon="🐛"
        disabled
      />

      <div className="ml-auto text-zinc-500 text-[11px] truncate max-w-[240px]">
        {status}
      </div>

      {dialogOpen && (
        <ConfigurationsDialog onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

function IconButton({
  title,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  icon: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={
        "w-8 h-8 flex items-center justify-center rounded text-[14px] transition-colors " +
        (disabled
          ? "text-zinc-600 cursor-default"
          : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100")
      }
    >
      {icon}
    </button>
  );
}

function ConfigChip({
  hasSolution,
  configs,
  selectedName,
  onSelect,
  onOpenDialog,
}: {
  hasSolution: boolean;
  configs: { name: string; kind: string; origin: string }[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onOpenDialog: () => void;
}) {
  const [open, setOpen] = useState(false);

  const userConfigs = configs.filter((c) => c.origin !== "inferred");
  const inferredConfigs = configs.filter((c) => c.origin === "inferred");

  const label = !hasSolution
    ? "No solution"
    : selectedName
    ? selectedName
    : configs.length > 0
    ? configs[0].name
    : "No configurations";

  return (
    <div className="relative">
      <button
        onClick={() => hasSolution && configs.length > 0 && setOpen((v) => !v)}
        disabled={!hasSolution}
        className={
          "h-8 px-3 rounded flex items-center gap-2 border text-[12px] transition-colors " +
          (hasSolution
            ? "border-zinc-700 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/40"
            : "border-zinc-800 text-zinc-600 cursor-default")
        }
      >
        <span className="truncate max-w-[260px]">{label}</span>
        <svg
          className={"w-3 h-3 shrink-0 text-zinc-500 transition-transform " + (open ? "rotate-180" : "")}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 min-w-[280px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 z-50 text-xs">
            {userConfigs.length > 0 && (
              <Group label="Configured">
                {userConfigs.map((c) => (
                  <MenuItem
                    key={`u-${c.name}`}
                    name={c.name}
                    kind={c.kind}
                    active={c.name === selectedName}
                    onClick={() => {
                      onSelect(c.name);
                      setOpen(false);
                    }}
                  />
                ))}
              </Group>
            )}

            {inferredConfigs.length > 0 && (
              <Group label="Inferred">
                {inferredConfigs.map((c) => (
                  <MenuItem
                    key={`i-${c.name}`}
                    name={c.name}
                    kind={c.kind}
                    active={c.name === selectedName}
                    onClick={() => {
                      onSelect(c.name);
                      setOpen(false);
                    }}
                  />
                ))}
              </Group>
            )}

            {configs.length === 0 && hasSolution && (
              <div className="px-3 py-2 text-[11.5px] text-zinc-500 italic">
                No configurations inferred.
                <br />
                Open the dialog to add one.
              </div>
            )}

            <div className="my-1 h-px bg-zinc-800" />
            <button
              onClick={() => {
                onOpenDialog();
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >
              Add / Edit Configurations…
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      {children}
    </div>
  );
}

function MenuItem({
  name,
  kind,
  active,
  onClick,
}: {
  name: string;
  kind: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] " +
        (active
          ? "bg-blue-900/40 text-zinc-100"
          : "text-zinc-200 hover:bg-blue-700 hover:text-white")
      }
    >
      <span className="truncate flex-1">{name}</span>
      <span className="text-[10px] text-zinc-500 shrink-0">{kind}</span>
    </button>
  );
}

export default memo(Toolbar);
