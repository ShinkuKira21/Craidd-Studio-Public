import { create } from "zustand";
import type { SaveRestartPlan } from "../lib/saveRestartPolicy";

interface SavePrompt {
  fileId: string;
  plan: SaveRestartPlan;
  save: () => Promise<boolean>;
}
interface SessionNotice {
  key: string;
  message: string;
  actionLabel?: string;
  action?: () => Promise<void>;
}
const seenNotices = new Set<string>();
export const useSessionFeedback = create<{
  savePrompt: SavePrompt | null;
  notice: SessionNotice | null;
}>(() => ({ savePrompt: null, notice: null }));

export function showSessionNotice(notice: SessionNotice): void {
  if (seenNotices.has(notice.key)) return;
  seenNotices.add(notice.key);
  if (seenNotices.size > 64) seenNotices.delete(seenNotices.values().next().value!);
  useSessionFeedback.setState({ notice });
}
