import { create } from "zustand";
import { useSolution } from "./solutionStore";

// The second editor group (D4: at most two groups). It shows one of the
// window's open tabs and shares that tab's Monaco model with the main editor.
interface SplitState {
  sideFileId: string | null;
  sideFocused: boolean;
  setSideFocused: (focused: boolean) => void;
  closeSide: () => void;
}

export const useSplit = create<SplitState>((set) => ({
  sideFileId: null,
  sideFocused: false,
  setSideFocused: (sideFocused) => set({ sideFocused }),
  closeSide: () => set({ sideFileId: null, sideFocused: false }),
}));

/** Open a file in the side group without changing what the main editor shows. */
export async function openInSideGroup(absolutePath: string): Promise<void> {
  const solution = useSolution.getState();
  const previous = solution.activeFileId;
  const name = absolutePath.split("/").filter(Boolean).pop() ?? absolutePath;
  await solution.openFile(absolutePath, name);
  const opened = useSolution.getState().tabs.find((tab) => tab.fileId === absolutePath);
  if (!opened) throw new Error(`${name} could not be opened`);
  if (previous && previous !== absolutePath) useSolution.getState().setActiveFile(previous);
  useSplit.setState({ sideFileId: absolutePath });
}
