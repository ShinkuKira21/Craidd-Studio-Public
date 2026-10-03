import { useSolution } from "../store/solutionStore";
import { useSessionFeedback } from "../store/sessionFeedbackStore";
import { planFileRestart } from "./sessionRestart";

let planningSave = false;

async function saveFile(fileId: string, force = false): Promise<boolean> {
  const state = useSolution.getState();
  const tab = state.tabs.find((item) => item.fileId === fileId);
  if (!tab) throw new Error("The file is no longer open.");
  const result = await state.saveFile(fileId, force);
  if (result === "conflict") state.setPendingSave({ fileId, kind: "newer" });
  if (result === "error") throw new Error(`Could not save ${tab.name}.`);
  return result === "saved";
}

export async function requestFileSave(fileId: string, force = false, onSaved?: () => void): Promise<void> {
  if (useSessionFeedback.getState().savePrompt || planningSave) return;
  planningSave = true;
  try {
    const tab = useSolution.getState().tabs.find((item) => item.fileId === fileId);
    if (!tab) return;
    const performSave = async () => {
      const saved = await saveFile(fileId, force);
      if (saved) onSaved?.();
      return saved;
    };
    const plan = tab.dirty || force ? await planFileRestart(fileId) : null;
    if (plan) {
      useSessionFeedback.setState({ savePrompt: { fileId, plan, save: performSave } });
      return;
    }
    await performSave();
  } finally { planningSave = false; }
}

export async function saveActiveFile(): Promise<void> {
  if (useSessionFeedback.getState().savePrompt) return;
  const state = useSolution.getState();
  if (!state.activeFileId) return;
  const tab = state.tabs.find((t) => t.fileId === state.activeFileId);
  if (!tab) return;
  if (tab.diskState === "deleted" || tab.diskState === "newer") {
    state.setPendingSave({ fileId: tab.fileId, kind: tab.diskState });
    return;
  }
  await requestFileSave(tab.fileId);
}

export async function saveActiveFileAs(): Promise<void> {
  if (useSessionFeedback.getState().savePrompt) return;
  const state = useSolution.getState();
  const tab = state.tabs.find((t) => t.fileId === state.activeFileId);
  if (!tab) return;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const chosen = await save({ defaultPath: tab.fileId });
  if (typeof chosen !== "string") return;
  const performSave = async () => { await useSolution.getState().saveFileAs(tab.fileId, chosen); return true; };
  const plan = await planFileRestart(tab.fileId);
  if (plan) {
    useSessionFeedback.setState({ savePrompt: { fileId: chosen, plan, save: performSave } });
    return;
  }
  await performSave();
}
