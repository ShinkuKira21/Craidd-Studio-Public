import type { Language } from "../types/project";

export interface LanguageMeta {
  id: Language;
  label: string;
  color: string;
  extensions: string[];
  wellKnownFiles: string[];
}

export const LANGUAGES: LanguageMeta[] = [
  { id: "rust",       label: "Rust",       color: "text-orange-400", extensions: ["rs"],                                     wellKnownFiles: ["Cargo.toml", "Cargo.lock"] },
  { id: "typescript", label: "TypeScript", color: "text-blue-400",   extensions: ["ts","tsx","mts","cts"],                   wellKnownFiles: ["tsconfig.json"] },
  { id: "javascript", label: "JavaScript", color: "text-yellow-400", extensions: ["js","jsx","mjs","cjs"],                   wellKnownFiles: [] },
  { id: "python",     label: "Python",     color: "text-green-400",  extensions: ["py"],                                     wellKnownFiles: ["pyproject.toml", "requirements.txt", "setup.py"] },
  { id: "cpp",        label: "C++",        color: "text-purple-400", extensions: ["cpp","cc","cxx","c","h","hpp","hxx"],     wellKnownFiles: ["CMakeLists.txt"] },
  { id: "csharp",     label: "C#",         color: "text-violet-400", extensions: ["cs"],                                     wellKnownFiles: [] },
  { id: "config",     label: "Config",     color: "text-zinc-400",   extensions: ["json","toml","yaml","yml","ini","conf"],  wellKnownFiles: [] },
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
