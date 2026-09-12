import EditorTabs from "./EditorTabs";
import Breadcrumb from "./Breadcrumb";
import CodeView from "./CodeView";

export default function EditorPane() {
  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-950">
      <EditorTabs />
      <Breadcrumb />
      <CodeView />
    </div>
  );
}
