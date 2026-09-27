import { memo, useEffect, useState } from "react";
import EditorTabs from "./EditorTabs";
import Breadcrumb from "./Breadcrumb";
import CodeView from "./CodeView";
import SaveConfirmDialog from "../dialogs/SaveConfirmDialog";

function EditorPane() {
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  useEffect(() => {
    const onRequest = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string") setPendingClose(id);
    };
    window.addEventListener("craidd:request-close", onRequest);
    return () => window.removeEventListener("craidd:request-close", onRequest);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 editor-surface bg-editor-bg">
      <EditorTabs requestClose={(id) => setPendingClose(id)} />
      <Breadcrumb />
      <CodeView />
      {pendingClose && (
        <SaveConfirmDialog
          fileId={pendingClose}
          onClose={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}

export default memo(EditorPane);
