export interface WorkspaceEntry {
  path: string;
  kind: "solution" | "folder";
  name: string;
  windowLabel: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface StartupState {
  recentSolutions: WorkspaceEntry[];
  lastSession: WorkspaceEntry[];
}

export const emptyStartupState: StartupState = {
  recentSolutions: [],
  lastSession: [],
};
