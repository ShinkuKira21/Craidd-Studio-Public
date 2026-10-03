import type { DuplicateWindowMode } from "../store/preferencesStore";

/** Ordinary File → Duplicate Window policy. LDI's Blue helper never calls this. */
export function shouldShowDuplicate(mode: DuplicateWindowMode, visibleCount: number, limit: number): boolean {
  if (mode === "show") return true;
  if (mode === "hide-and-view") return false;
  return visibleCount < limit;
}
