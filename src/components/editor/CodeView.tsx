import Editor from "@monaco-editor/react";
import { useWorkspace } from "../../store/workspaceStore";
import { usePreferences } from "../../store/preferencesStore";

const samples: Record<string, { lang: string; code: string }> = {
  rust: {
    lang: "rust",
    code: `use tauri::{Builder, Manager};
mod commands;

// Entry point for the Tauri core
fn main() {
    Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::get_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}

pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}
`,
  },
  typescript: {
    lang: "typescript",
    code: `import { useState } from "react";

export default function App() {
  const [msg, setMsg] = useState("");

  return (
    <div>
      <h1>Welcome</h1>
      <p>{msg}</p>
    </div>
  );
}
`,
  },
};

export default function CodeView({ fileId }: { fileId: string | null }) {
  const tabs = useWorkspace((s) => s.tabs);
  const active = tabs.find((t) => t.fileId === fileId);
  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm bg-zinc-950">
        No file open
      </div>
    );
  }

  const sample = samples[active.language] ?? samples.rust;

  return (
    <div className="flex-1 min-h-0 bg-zinc-950">
      <Editor
        height="100%"
        language={sample.lang}
        value={sample.code}
        theme="vs-dark"
        options={{
          readOnly: true,
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          lineNumbers: "on",
          glyphMargin: true,
          folding: true,
          automaticLayout: true,
          wordWrap: wordWrap ? "on" : "off",
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
