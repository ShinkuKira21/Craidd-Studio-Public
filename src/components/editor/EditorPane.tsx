import SplitEditor from "./panes/SplitEditor";

export default function EditorPane() {
  return (
    <div id="editor-split-container" className="flex-1 flex min-w-0 min-h-0 bg-zinc-950">
      <SplitEditor />
    </div>
  );
}
