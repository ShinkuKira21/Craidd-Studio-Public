import EditorPane from "./EditorPane";
import { useLayout } from "../../../store/layoutStore";
import ResizeHandle from "../../layout/ResizeHandle";

export default function SplitEditor() {
  const panes = useLayout((s) => s.panes);
  const splitRatio = useLayout((s) => s.splitRatio);
  const setSplitRatio = useLayout((s) => s.setSplitRatio);

  if (panes.length === 1) {
    return (
      <div className="flex-1 flex min-h-0 min-w-0">
        <EditorPane paneId={panes[0].id} />
      </div>
    );
  }

  // Two panes: split by ratio
  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      <div style={{ width: `${splitRatio}%` }} className="flex min-h-0">
        <EditorPane paneId={panes[0].id} />
      </div>
      <ResizeHandle
        orientation="vertical"
        onDrag={(delta) => {
          const container = document.getElementById("editor-split-container");
          if (!container) return;
          const total = container.clientWidth;
          const next = splitRatio + (delta / total) * 100;
          setSplitRatio(next);
        }}
      />
      <div style={{ width: `${100 - splitRatio}%` }} className="flex min-h-0">
        <EditorPane paneId={panes[1].id} />
      </div>
    </div>
  );
}
