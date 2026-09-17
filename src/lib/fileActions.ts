import { useSolution } from "../store/solutionStore";

export async function saveActiveFile(): Promise<void> {
  const state = useSolution.getState();
  if (!state.activeFileId) return;
  const tab = state.tabs.find((t) => t.fileId === state.activeFileId);
  if (!tab) return;
  if (tab.diskState === "deleted" || tab.diskState === "newer") {
    state.setPendingSave({ fileId: tab.fileId, kind: tab.diskState });
    return;
  }
  const result = await state.saveFile(tab.fileId);
  if (result === "conflict") state.setPendingSave({ fileId: tab.fileId, kind: "newer" });
  if (result === "error") throw new Error(`Could not save ${tab.name}.`);
}

export async function saveActiveFileAs(): Promise<void> {
  const state = useSolution.getState();
  const tab = state.tabs.find((t) => t.fileId === state.activeFileId);
  if (!tab) return;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const chosen = await save({ defaultPath: tab.fileId });
  if (typeof chosen === "string") await useSolution.getState().saveFileAs(tab.fileId, chosen);
}
