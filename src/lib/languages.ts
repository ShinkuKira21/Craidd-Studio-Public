import type { Language } from "../types/project";

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
    extensions: ["ts", "tsx", "mts", "cts"],
    wellKnownFiles: ["tsconfig.json"],
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
