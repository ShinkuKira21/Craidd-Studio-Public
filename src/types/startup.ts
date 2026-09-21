export interface WorkspaceEntry {
  path: string;
  kind: "solution" | "folder";
  name: string;
  windowLabel: string;
  instanceId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  selectedConfigName?: string;
  selectedProfileName?: string;
  selectionName?: string;
  restoredTabs?: string[];
  restoredActiveFile?: string;
  restoredFromHidden?: boolean;
}

export interface StartupState {
  recentSolutions: WorkspaceEntry[];
  lastSession: WorkspaceEntry[];
}

export const emptyStartupState: StartupState = {
  recentSolutions: [],
  lastSession: [],
};
