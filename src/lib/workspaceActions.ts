// File → Open Folder / Open Solution, shared by the menu and the shortcuts.

export async function openFolderDialog(): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_workspace_window", { entry: {
    path: selected, kind: "folder", name: selected.split("/").filter(Boolean).pop() ?? selected, windowLabel: "",
  } });
}

export async function openSolutionDialog(): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, filters: [{ name: "Craidd Solution", extensions: ["cln"] }] });
  if (typeof selected !== "string") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_workspace_window", { entry: {
    path: selected, kind: "solution", name: selected.split("/").filter(Boolean).pop() ?? selected, windowLabel: "",
  } });
}
