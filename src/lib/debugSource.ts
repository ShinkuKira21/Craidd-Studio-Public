import { useSolution } from "../store/solutionStore";
import { showSessionNotice } from "../store/sessionFeedbackStore";

/** Debug information may name SDK/distro sources that are not installed.
 * Keep the stop and stack usable; this is not a solution-opening failure. */
export async function revealDebugSource(file: string, line: number, column = 1, isCurrent = () => true): Promise<boolean> {
  try {
    const solution = useSolution.getState();
    if (!solution.tabs.some((tab) => tab.fileId === file)) {
      const { invoke } = await import("@tauri-apps/api/core");
      const stats = await invoke<{ exists: boolean; readable: boolean }[]>("stat_files", { paths: [file] });
      if (!isCurrent()) return false;
      if (!stats[0]?.exists || !stats[0].readable) {
        showSessionNotice({ key: `debug-source:${file}`, message: `Debugger source is unavailable: ${file}. The process is still paused; you can Continue or Step Out. Install the matching toolchain sources or configure source mapping to view this frame.` });
        return false;
      }
    }
    if (!isCurrent()) return false;
    await solution.revealFile(file, line, column);
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    showSessionNotice({ key: `debug-source:${file}`, message: `Could not reveal debugger source ${file}: ${String(error)}. The debugger controls remain available.` });
    return false;
  }
}
