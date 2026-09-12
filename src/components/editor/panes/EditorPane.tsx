import EditorTabs from "../EditorTabs";
import Breadcrumb from "../Breadcrumb";
import CodeView from "../CodeView";
import { useLayout } from "../../../store/layoutStore";

export default function EditorPane({ paneId }: { paneId: string }) {
  const pane = useLayout((s) => s.panes.find((p) => p.id === paneId));
  const setFocusedPane = useLayout((s) => s.setFocusedPane);
  const focusedPaneId = useLayout((s) => s.focusedPaneId);
  const isFocused = focusedPaneId === paneId;

  return (
    <div
      onMouseDown={() => setFocusedPane(paneId)}
      className={
        "flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-950 " +
        (isFocused ? "" : "opacity-95")
      }
    >
      <EditorTabs paneId={paneId} />
      <Breadcrumb fileId={pane?.activeFileId ?? null} />
      <CodeView fileId={pane?.activeFileId ?? null} />
    </div>
  );
}
