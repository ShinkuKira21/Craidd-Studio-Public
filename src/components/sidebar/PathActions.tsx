import { useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { copyText, findVsCode, openInVsCode, relativePath, revealInFileManager } from "../../lib/pathActions";

const item = "w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white";

/** Open and copy items for a file or folder context menu. */
export default function PathActions({ path, isFile, onDone, onOpenToSide }: {
  path: string; isFile: boolean; onDone: () => void; onOpenToSide?: () => void;
}) {
  const rootPath = useSolution((s) => s.rootPath);
  const [vscode, setVscode] = useState<string | null>(null);
  useEffect(() => { void findVsCode().then(setVscode); }, []);
  const act = (what: string, action: () => Promise<void> | void) => () => {
    onDone();
    void Promise.resolve().then(action).catch((error) => alert(`${what} failed: ${String(error)}`));
  };
  return <>
    {isFile && onOpenToSide && <button className={item} onClick={act("Open in Side Window", onOpenToSide)}>Open in Side Window</button>}
    <button className={item} onClick={act("Open in File Explorer", () => revealInFileManager(path))}>Open in File Explorer</button>
    {vscode && <button className={item} title={vscode} onClick={act("Open in VS Code", () => openInVsCode(path))}>Open in VS Code</button>}
    <button className="w-full px-3 py-1 text-left text-zinc-600 cursor-default" disabled title="The integrated terminal is planned for Phase 3.y">
      Open in Integrated Terminal (Coming soon)
    </button>
    <div className="my-1 h-px bg-zinc-800" />
    <button className={item} onClick={act("Copy Path", () => copyText(path))}>Copy Path</button>
    <button className={item} onClick={act("Copy Relative Path", () => copyText(relativePath(rootPath, path)))}>Copy Relative Path</button>
  </>;
}
