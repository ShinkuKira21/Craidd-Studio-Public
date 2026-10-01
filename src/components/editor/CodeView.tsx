import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";
import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import type { Breakpoint } from "../../store/breakpointStore";
import { useDebug } from "../../store/debugStore";
import BreakpointMenu from "./BreakpointMenu";
import { CRAIDD_DARK_THEME, defineCraiddDarkTheme } from "../../lib/editorThemes";
import { listLdiCallSites, reconcileLdiBluesOnSave, removeLdiBlue, setLdiBlue, setupLdiBlue, useLdi } from "../../store/ldiStore";
import type { LdiBlue, LdiCallSite } from "../../store/ldiStore";
import type { CraiddSolution } from "../../types/project";

interface CallSiteCacheEntry {
  savedContent: string;
  selectionKey: string;
  solution: CraiddSolution | null;
  sites: LdiCallSite[];
}

function blueKey(blue: LdiBlue): string {
  return `${blue.file}\u0000${blue.line}\u0000${blue.originLabel}\u0000${blue.partnerLabel}`;
}

function breakpointDecorations(monaco: Monaco, points: Breakpoint[], file: string | null, pausedLine: number | null,
  callSites: LdiCallSite[], dirty: boolean, liveBlueLines: Map<string, number>) {
  const blues = useLdi.getState().blues;
  const linked = useLinkedWindows.getState();
  const library = linked.windows.find((item) => item.windowLabel === linked.ownWindowLabel)?.ldiRole === "native-library"
    && /\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/.test(file ?? "");
  const managed = linked.windows.find((item) => item.ldiRole === "managed");
  const lines = [...new Set(points.filter((point) => point.file === file).map((point) => point.line))];
  return [...lines.map((line) => {
    const condition = points.find((point) => point.file === file && point.line === line)?.condition;
    const unmatchedLibrary = library && !blues.some((blue) => blue.nativePoints.some((point) => point.file === file && point.line === line));
    const reminder = unmatchedLibrary
      ? `LDI reminder: right-click the C# gutter in ${managed ? `CS${managed.windowId}` : "a linked managed window"} where this extern function is called (not defined), and choose Native Debugging Breakpoint. A red library marker alone does not launch a reproduction; use a .c/.cpp implementation, not a header prototype.`
      : `Breakpoint · line ${line}`;
    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: unmatchedLibrary ? "craidd-breakpoint craidd-breakpoint-warning" : "craidd-breakpoint",
        glyphMarginHoverMessage: { value: `${reminder}${condition ? `\nCondition: ${condition}` : ""}` },
      },
    };
  }), ...blues.filter((blue) => blue.file === file && blue.originLabel === linked.ownWindowLabel).map((blue) => {
    const warning = [blue.warning, dirty ? "Unsaved edits: Blue still uses the last saved call site. Save to revalidate it." : null]
      .filter(Boolean).join("\n");
    return { range: new monaco.Range(liveBlueLines.get(blueKey(blue)) ?? blue.line, 1,
      liveBlueLines.get(blueKey(blue)) ?? blue.line, 1),
      options: { isWholeLine: false, glyphMarginClassName: `craidd-breakpoint craidd-breakpoint-blue${warning ? " craidd-breakpoint-warning" : ""}`,
        glyphMarginHoverMessage: { value: warning ? `⚠ ${warning}` : `Native Debugging Breakpoint → CS${blue.partnerWindowId} · ${blue.entryPoint}${blue.condition ? `\nCondition: ${blue.condition}` : ""}\nB stops at ${blue.landing === "automatic-entry" ? "the native export entry (automatic)" : "the matching red breakpoint"}.\n\nGold Linked Debug only. ${blue.mode === "typed-interposer" ? "A advances to a pre-call native hold; B reproduces before A's real call." : "A remains at this stop until B finishes."}` } } };
  }), ...callSites.filter((site) => !lines.includes(site.line)
    && !blues.some((blue) => blue.file === file && blue.line === site.line && blue.originLabel === linked.ownWindowLabel))
    .map((site) => {
      const partners = site.partnerLabels.map((label) => linked.windows.find((item) => item.windowLabel === label))
        .filter((item) => item !== undefined);
      const names = partners.map((item) => `CS${item.windowId}: ${item.selectedConfigName ?? item.projectName}`).join(", ");
      const needsWindow = partners.length === 0 && site.configNames.length > 0;
      const choices = site.configNames.join(", ");
      return { range: new monaco.Range(site.line, 1, site.line, 1), options: {
        isWholeLine: false, glyphMarginClassName: `craidd-breakpoint craidd-breakpoint-ghost-blue${needsWindow ? " craidd-breakpoint-ghost-needs-window" : ""}`,
        glyphMarginHoverMessage: { value: needsWindow
          ? `⚠ You need to duplicate this window and open Power Config: ${choices}, where ${site.entryPoint} exists. ${site.configNames.length === 1 ? "If you left-click, the IDE will try to do this for you." : "Left-click to choose which native configuration to open."} Right-click for other breakpoint options.`
          : `Set Blue Breakpoint → ${names} (${site.entryPoint}). ${site.partnerLabels.length === 1 ? "Left-click to set it" : "Left-click to choose the partner"}; right-click for other breakpoint options. Gold Linked Debug only.` },
      } };
    }), ...(pausedLine ? [{ range: new monaco.Range(pausedLine, 1, pausedLine, 1), options: { isWholeLine: true, className: "craidd-paused-line" } }] : [])];
}

function revealCurrentNavigation(instance: editor.IStandaloneCodeEditor) {
  const { navigation, activeFileId } = useSolution.getState();
  if (!navigation || navigation.fileId !== activeFileId || instance.getModel()?.uri.path !== activeFileId) return;
  const position = { lineNumber: navigation.line, column: navigation.column };
  instance.setPosition(position);
  instance.revealPositionInCenter(position);
  instance.focus();
}

export default function CodeView() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const trackedPointsRef = useRef<Breakpoint[]>([]);
  const trackedBluesRef = useRef<LdiBlue[]>([]);
  const callSitesRef = useRef<LdiCallSite[]>([]);
  const callSiteCacheRef = useRef(new Map<string, CallSiteCacheEntry>());
  const [breakpointMenu, setBreakpointMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const [callSites, setCallSites] = useState<LdiCallSite[]>([]);
  const [breakpointError, setBreakpointError] = useState<string | null>(null);
  const activeFileId = useSolution((s) => s.activeFileId);
  const activeDirty = useSolution((s) => s.tabs.find((tab) => tab.fileId === s.activeFileId)?.dirty ?? false);
  const solution = useSolution((s) => s.solution);
  const savedContent = useSolution((s) => s.tabs.find((tab) => tab.fileId === s.activeFileId)?.originalContent ?? "");
  const points = useBreakpoints((s) => s.points);
  const blues = useLdi((s) => s.blues);
  const ldiSelectionKey = useLinkedWindows((s) => {
    const own = s.windows.find((item) => item.windowLabel === s.ownWindowLabel);
    return [own?.ldiRole ?? "", ...s.windows.filter((item) => item.ldiRole === "native-library")
      .map((item) => `${item.windowLabel}:${item.selectedConfigName ?? ""}:${item.selectedProfileName ?? ""}`)].join("|");
  });
  const remoteEditContext = useLinkedWindows((s) => s.remoteEditing
    ? s.windows.find((item) => item.windowLabel === s.viewedWindowLabel && item.windowLabel !== s.ownWindowLabel)
    : undefined);
  const debugStatus = useDebug((s) => s.status);
  const debugFile = useDebug((s) => s.file);
  const debugLine = useDebug((s) => s.line);
  const pausedLine = remoteEditContext
    ? remoteEditContext.status === "paused" && remoteEditContext.activeFile?.path === activeFileId ? remoteEditContext.pausedLine : null
    : debugStatus === "paused" && debugFile === activeFileId ? debugLine : null;
  const navigation = useSolution((s) => s.navigation);
  // Monaco owns the live text while typing. The store still receives every
  // change for Save, but React only needs to rerender on a tab switch or a
  // disk reload (which changes originalContent).
  const updateTabContent = useSolution((s) => s.updateTabContent);
  const active = useSolution.getState().tabs.find((t) => t.fileId === activeFileId);

  useEffect(() => {
    const clear = () => { callSitesRef.current = []; setCallSites([]); };
    if (!activeFileId?.endsWith(".cs") || activeDirty) { clear(); return; }
    const linked = useLinkedWindows.getState();
    if (linked.windows.find((item) => item.windowLabel === linked.ownWindowLabel)?.ldiRole !== "managed") { clear(); return; }
    const cached = callSiteCacheRef.current.get(activeFileId);
    if (cached && cached.savedContent === savedContent && cached.selectionKey === ldiSelectionKey && cached.solution === solution) {
      callSitesRef.current = cached.sites;
      setCallSites(cached.sites);
      return;
    }
    clear();
    const partners = linked.windows.filter((item) => item.ldiRole === "native-library").map((item) => item.windowLabel);
    let cancelled = false;
    void listLdiCallSites(activeFileId, partners).then((sites) => {
      if (cancelled) return;
      const cache = callSiteCacheRef.current;
      cache.delete(activeFileId);
      cache.set(activeFileId, { savedContent, selectionKey: ldiSelectionKey, solution, sites });
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
      callSitesRef.current = sites;
      setCallSites(sites);
    }).catch((error) => console.warn("[LDI] Could not preview native call sites:", error));
    return () => { cancelled = true; };
  }, [activeFileId, activeDirty, savedContent, ldiSelectionKey, solution]);

  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);
  const tabSize = usePreferences((s) => s.tabSize);
  const theme = usePreferences((s) => s.theme);
  const options = useMemo(() => ({
    readOnly: false,
    fontSize,
    tabSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "line" as const,
    lineNumbers: "on" as const,
    glyphMargin: true,
    folding: true,
    automaticLayout: true,
    wordWrap: wordWrap ? "on" as const : "off" as const,
    padding: { top: 8, bottom: 8 },
  }), [fontSize, tabSize, wordWrap]);
  const onChange = useCallback((value: string | undefined) => {
    if (typeof value === "string" && activeFileId) updateTabContent(activeFileId, value);
  }, [activeFileId, updateTabContent]);

  useEffect(() => {
    if (!navigation || navigation.fileId !== activeFileId) return;
    const frame = requestAnimationFrame(() => {
      const instance = editorRef.current;
      if (instance) revealCurrentNavigation(instance);
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, activeFileId]);

  // Monaco can mount after React has already run the effect for a newly
  // opened file. Read the latest stores at mount time, not render-time props,
  // so adopting a hidden session never paints its marker as another window.
  const refreshBreakpoints = useCallback(() => {
    const decorations = decorationsRef.current;
    const monaco = monacoRef.current;
    if (!decorations || !monaco) return;
    const file = useSolution.getState().activeFileId;
    const currentPoints = useBreakpoints.getState().points;
    const linked = useLinkedWindows.getState();
    const target = linked.remoteEditing ? linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel
      && item.windowLabel !== linked.ownWindowLabel) : null;
    const debug = useDebug.getState();
    const currentPausedLine = target
      ? target.status === "paused" && target.activeFile?.path === file ? target.pausedLine : null
      : debug.status === "paused" && debug.file === file ? debug.line : null;
    const liveBlueLines = new Map<string, number>();
    trackedBluesRef.current.forEach((blue, index) => {
      const line = decorations.getRange(trackedPointsRef.current.length + index)?.startLineNumber;
      if (line) liveBlueLines.set(blueKey(blue), line);
    });
    trackedPointsRef.current = currentPoints.filter((point) => point.file === file)
      .filter((point, index, all) => all.findIndex((item) => item.line === point.line) === index);
    trackedBluesRef.current = useLdi.getState().blues.filter((blue) => blue.file === file && blue.originLabel === linked.ownWindowLabel);
    const dirty = useSolution.getState().tabs.find((tab) => tab.fileId === file)?.dirty ?? false;
    decorations.set(breakpointDecorations(monaco, currentPoints, file, currentPausedLine, callSitesRef.current, dirty, liveBlueLines));
  }, []);

  useEffect(() => { refreshBreakpoints(); }, [refreshBreakpoints, points, blues, callSites, activeDirty, activeFileId, remoteEditContext?.windowLabel, pausedLine]);

  useEffect(() => {
    const onSaved = (event: Event) => {
      const file = (event as CustomEvent<string>).detail;
      if (file !== useSolution.getState().activeFileId) return;
      const decorations = decorationsRef.current;
      if (!decorations) return;
      const moves = trackedPointsRef.current.flatMap((point, index) => {
        const line = decorations.getRange(index)?.startLineNumber;
        return line && line !== point.line ? [{ from: point.line, to: line }] : [];
      });
      if (moves.length) void useBreakpoints.getState().moveLines(file, moves)
        .catch((error) => console.error("[craidd] Could not move saved breakpoints:", error));
      if (file.endsWith(".cs")) void reconcileLdiBluesOnSave(file)
        .catch((error) => setBreakpointError(`Saved, but Blue could not move: ${String(error)}. Stop Gold Debug and save again to revalidate.`));
    };
    window.addEventListener("craidd:file-saved", onSaved);
    return () => window.removeEventListener("craidd:file-saved", onSaved);
  }, []);

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm bg-editor-bg">
        Open a file from File Discovery to view it.
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 bg-editor-bg">
      <Editor
        height="100%"
        path={active.fileId}
        language={active.monacoLanguage}
        value={active.content}
        theme={theme === "craidd-dark" ? CRAIDD_DARK_THEME : theme}
        beforeMount={defineCraiddDarkTheme}
        onChange={onChange}
        onMount={(instance, monaco) => {
          editorRef.current = instance;
          monacoRef.current = monaco;
          decorationsRef.current = instance.createDecorationsCollection();
          refreshBreakpoints();
          revealCurrentNavigation(instance);
          instance.onDidChangeModel(() => { revealCurrentNavigation(instance); refreshBreakpoints(); });
          instance.onMouseDown((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.event.leftButton) return;
            const file = useSolution.getState().activeFileId;
            const line = event.target.position?.lineNumber;
            if (!file || !line) return;
            setBreakpointError(null);
            const blue = useLdi.getState().blues.some((point) => point.file === file && point.line === line
              && point.originLabel === useLinkedWindows.getState().ownWindowLabel);
            const red = useBreakpoints.getState().points.some((point) => point.file === file && point.line === line);
            const site = callSitesRef.current.find((item) => item.line === line);
            if (blue) void removeLdiBlue(file, line).catch((error) => setBreakpointError(String(error)));
            else if (!red && site?.partnerLabels.length === 1) {
              void setLdiBlue(file, line, site.partnerLabels[0]).catch((error) => setBreakpointError(String(error)));
            } else if (!red && site?.partnerLabels.length === 0 && site.configNames.length === 1) {
              void setupLdiBlue(file, line, site.configNames[0], true).catch((error) => setBreakpointError(String(error)));
            } else if (!red && site && (site.partnerLabels.length > 1 || site.configNames.length > 1)) {
              setBreakpointMenu({ x: event.event.posx, y: event.event.posy, line });
            } else void useBreakpoints.getState().toggle(file, line).catch((error) => setBreakpointError(String(error)));
          });
          instance.onContextMenu((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
              && event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
            const line = event.target.position?.lineNumber;
            if (!line) return;
            event.event.preventDefault();
            setBreakpointMenu({ x: event.event.posx, y: event.event.posy, line });
          });
        }}
        options={options}
      />
      {breakpointError && <div role="alert" className="absolute bottom-3 right-3 z-30 max-w-sm rounded border border-amber-600 bg-zinc-900 px-3 py-2 text-xs text-amber-200 shadow-xl">
        {breakpointError}
        <button type="button" className="ml-3 text-zinc-400 hover:text-white" onClick={() => setBreakpointError(null)}>Dismiss</button>
      </div>}
      {breakpointMenu && activeFileId && <BreakpointMenu file={activeFileId}
        line={breakpointMenu.line} x={breakpointMenu.x} y={breakpointMenu.y}
        callSite={callSites.find((site) => site.line === breakpointMenu.line)}
        onClose={() => setBreakpointMenu(null)} />}
    </div>
  );
}
