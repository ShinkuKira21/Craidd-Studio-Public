import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { readBreakpointFocusMode } from "../store/preferencesStore";
import { useLinkedWindows } from "../store/linkedWindowsStore";

const LAST_TYPING_KEY = "craidd:last-typing";

/** Future debugger adapters emit this event only after a real pause. */
export async function listenForBreakpointFocus(): Promise<() => void> {
  const current = getCurrentWindow();
  let lastRecorded = 0;
  let originalTitle: string | null = null;
  let badgeRequest = 0;
  let disposed = false;
  const onKeyDown = () => {
    const now = Date.now();
    if (now - lastRecorded < 250) return;
    lastRecorded = now;
    try { localStorage.setItem(LAST_TYPING_KEY, String(now)); } catch { /* Best effort. */ }
  };
  const clearBadge = () => {
    badgeRequest += 1;
    if (originalTitle === null) return;
    const title = originalTitle;
    originalTitle = null;
    void current.setTitle(title).catch(() => {});
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("focus", clearBadge);
  const unlisten = await listen("craidd:debug-paused", () => {
    if (disposed || !useLinkedWindows.getState().linked) return;
    const mode = readBreakpointFocusMode();
    let lastTyping = 0;
    try { lastTyping = Number(localStorage.getItem(LAST_TYPING_KEY) ?? 0); } catch { /* Best effort. */ }
    if (mode === "always" || (mode === "idle" && Date.now() - lastTyping >= 2000)) {
      void current.setFocus().catch(() => {});
      return;
    }
    if (originalTitle === null) {
      const request = ++badgeRequest;
      void current.title().then((title) => {
        if (disposed || request !== badgeRequest || originalTitle !== null) return;
        originalTitle = title;
        return current.setTitle(`● ${title}`);
      }).catch(() => {});
    }
  });
  const unlistenResume = await listen("craidd:debug-resumed", clearBadge);
  return () => {
    disposed = true;
    unlisten();
    unlistenResume();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("focus", clearBadge);
    clearBadge();
  };
}
