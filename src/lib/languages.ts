import type { Language, Framework } from "../types/project";

export interface LanguageMeta {
  id: Language;
  label: string;
  color: string;
  extensions: string[];
  wellKnownFiles: string[];
  interopExtensions: string[];       // additional extensions that belong to this project
}

export const LANGUAGES: LanguageMeta[] = [
  {
    id: "rust",
    label: "Rust",
    color: "text-orange-400",
    extensions: ["rs"],
    wellKnownFiles: ["Cargo.toml", "Cargo.lock"],
    interopExtensions: [],
  },
  {
    id: "typescript",
    label: "TypeScript",
    color: "text-blue-400",
    extensions: ["ts", "tsx", "mts", "cts", "d.ts"],
    wellKnownFiles: ["tsconfig.json", "vite-env.d.ts"],
    interopExtensions: ["js", "jsx", "mjs", "cjs"],   // TS project may include JS
  },
  {
    id: "javascript",
    label: "JavaScript",
    color: "text-yellow-400",
    extensions: ["js", "jsx", "mjs", "cjs"],
    wellKnownFiles: [],
    interopExtensions: ["ts", "tsx"],
  },
  {
    id: "python",
    label: "Python",
    color: "text-green-400",
    extensions: ["py"],
    wellKnownFiles: ["pyproject.toml", "requirements.txt", "setup.py"],
    interopExtensions: ["c", "h"],                    // C extensions
  },
  {
    id: "cpp",
    label: "C++",
    color: "text-purple-400",
    extensions: ["cpp", "cc", "cxx", "c", "h", "hpp", "hxx"],
    wellKnownFiles: ["CMakeLists.txt"],
    interopExtensions: [],
  },
  {
    id: "csharp",
    label: "C#",
    color: "text-violet-400",
    extensions: ["cs"],
    wellKnownFiles: [],
    interopExtensions: ["c", "cpp", "h", "hpp"],      // P/Invoke
  },
  {
    id: "config",
    label: "Config",
    color: "text-zinc-400",
    extensions: ["json", "toml", "yaml", "yml", "ini", "conf"],
    wellKnownFiles: [],
    interopExtensions: [],
  },
];

export function languageMeta(id: Language): LanguageMeta {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[LANGUAGES.length - 1];
}

export function languageFromFilename(name: string): Language | "plaintext" {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  for (const lang of LANGUAGES) {
    if (lang.extensions.includes(ext)) return lang.id;
  }
  return "plaintext";
}

/** Combined extension list: primary + interop. */
export function projectExtensions(language: Language): string[] {
  const meta = languageMeta(language);
  return [...meta.extensions, ...meta.interopExtensions];
}

export function projectWellKnownFiles(language: Language): string[] {
  return languageMeta(language).wellKnownFiles;
}

/**
 * Monaco language id for a filename. Purely cosmetic — controls syntax
 * highlighting in the editor tab. Does NOT affect project classification.
 * Extensions declare nothing here; they only pick a lexer.
 */
export function monacoLanguageForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  if (lower === ".gitignore" || lower === ".env") return "plaintext";
  const parts = lower.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";

  switch (ext) {
    case "rs": return "rust";
    case "ts": case "tsx": case "mts": case "cts": return "typescript";
    case "js": case "jsx": case "mjs": case "cjs": return "javascript";
    case "json": case "jsonc": return "json";
    case "toml": return "ini";              // Monaco doesn't ship TOML; ini lexer is close enough
    case "yaml": case "yml": return "yaml";
    case "ini": case "conf": return "ini";
    case "md": case "markdown": return "markdown";
    case "html": case "htm": return "html";
    case "css": return "css";
    case "scss": return "scss";
    case "less": return "less";
    case "xml": return "xml";
    case "svg": return "xml";
    case "sh": case "bash": case "zsh": return "shell";
    case "py": return "python";
    case "c": case "h": return "c";
    case "cpp": case "cc": case "cxx": case "hpp": case "hxx": return "cpp";
    case "cs": return "csharp";
    case "java": return "java";
    case "go": return "go";
    case "rb": return "ruby";
    case "php": return "php";
    case "sql": return "sql";
    case "lua": return "lua";
    case "kt": case "kts": return "kotlin";
    case "swift": return "swift";
    case "dart": return "dart";
    case "r": return "r";
    case "pl": return "perl";
    case "hs": return "haskell";
    case "ex": case "exs": return "elixir";
    case "clj": case "cljs": return "clojure";
    case "scala": return "scala";
    case "fs": case "fsx": return "fsharp";
    case "vb": return "vb";
    case "ps1": return "powershell";
    case "bat": case "cmd": return "bat";
    case "graphql": case "gql": return "graphql";
    case "proto": return "protobuf";
    default: return "plaintext";
  }
}


/**
 * The valid frameworks for a given language.
 *
 * v1 is a closed set: five languages, four frameworks. "standard" is
 * available for every language. Everything else is out of scope — see
 * docs/design-project-identity.md.
 */
export function frameworksFor(language: Language): Framework[] {
  switch (language) {
    case "rust":
      return ["standard", "tauri"];
    case "typescript":
    case "javascript":
      return ["standard", "tauri"];
    case "csharp":
      return ["standard", "aspnet"];
    case "cpp":
      return ["standard", "cmake"];
    case "python":
    case "config":
      return ["standard"];
    default:
      return ["standard"];
  }
}
