// Exit → This Application: what stops a normal exit, by window name.
// See docs/uiux/design-public-release-sweep.md §6.

export interface ExitProbe {
  label: string;
  name: string;
  restoring: boolean;
  /** Unsaved file count, or null when the window could not be asked. */
  dirty: number | null;
  error?: string | null;
}

export interface ExitPlan {
  /** Windows with unsaved files, prompted in order with Save All. */
  queue: string[];
  /** Reasons the IDE cannot check every window; each offers Exit anyway. */
  blockers: string[];
}

export function planExit(probes: ExitProbe[]): ExitPlan {
  const queue: string[] = [];
  const blockers: string[] = [];
  for (const probe of probes) {
    if (probe.restoring) blockers.push(`${probe.name} is still opening.`);
    else if (probe.dirty === null) blockers.push(`${probe.name} did not respond${probe.error ? ` (${probe.error})` : ""}.`);
    else if (probe.dirty > 0) queue.push(probe.label);
  }
  return { queue, blockers };
}

/** An unregistered window can't be prompted through the registry; its own unsaved tabs become a blocker. */
export function unregisteredBlocker(dirty: number): string | null {
  return dirty > 0 ? `This window has ${dirty} unsaved file${dirty === 1 ? "" : "s"} and is not registered with the IDE.` : null;
}
