import type { Project, EditorTab, StackFrame, Breakpoint, DebugContext } from "../types/project";

export const mockProject: Project = {
  name: "my-tauri-app",
  root: ".",
  trees: [
    {
      id: "rust-core",
      label: "Rust (Core)",
      language: "rust",
      root: "src-tauri/",
      color: "text-orange-400",
      icon: "🦀",
      nodes: [
        {
          id: "rust-core/src",
          name: "src",
          path: "src",
          kind: "folder",
          children: [
            {
              id: "rust-core/src/main.rs",
              name: "main.rs",
              path: "src/main.rs",
              kind: "file",
              hasBreakpoint: true,
            },
            {
              id: "rust-core/src/lib.rs",
              name: "lib.rs",
              path: "src/lib.rs",
              kind: "file",
            },
            {
              id: "rust-core/src/commands.rs",
              name: "commands.rs",
              path: "src/commands.rs",
              kind: "file",
              hasBreakpoint: true,
            },
          ],
        },
        {
          id: "rust-core/Cargo.toml",
          name: "Cargo.toml",
          path: "Cargo.toml",
          kind: "file",
        },
        {
          id: "rust-core/tauri.conf.json",
          name: "tauri.conf.json",
          path: "tauri.conf.json",
          kind: "file",
        },
      ],
    },
    {
      id: "ts-frontend",
      label: "TypeScript (Frontend)",
      language: "typescript",
      root: "src/",
      color: "text-blue-400",
      icon: "⚛",
      nodes: [
        {
          id: "ts-frontend/components",
          name: "components",
          path: "components",
          kind: "folder",
          children: [],
        },
        {
          id: "ts-frontend/hooks",
          name: "hooks",
          path: "hooks",
          kind: "folder",
          children: [],
        },
        {
          id: "ts-frontend/App.tsx",
          name: "App.tsx",
          path: "App.tsx",
          kind: "file",
          vcsStatus: "M",
        },
        {
          id: "ts-frontend/main.tsx",
          name: "main.tsx",
          path: "main.tsx",
          kind: "file",
        },
      ],
    },
    {
      id: "config",
      label: "Config",
      language: "config",
      root: ".",
      color: "text-zinc-400",
      icon: "⚙",
      nodes: [
        {
          id: "config/package.json",
          name: "package.json",
          path: "package.json",
          kind: "file",
        },
        {
          id: "config/vite.config.ts",
          name: "vite.config.ts",
          path: "vite.config.ts",
          kind: "file",
        },
        {
          id: "config/tsconfig.json",
          name: "tsconfig.json",
          path: "tsconfig.json",
          kind: "file",
        },
      ],
    },
  ],
};

export const mockTabs: EditorTab[] = [
  {
    fileId: "rust-core/src/main.rs",
    treeId: "rust-core",
    name: "main.rs",
    language: "rust",
  },
  {
    fileId: "rust-core/src/commands.rs",
    treeId: "rust-core",
    name: "commands.rs",
    language: "rust",
  },
  {
    fileId: "ts-frontend/App.tsx",
    treeId: "ts-frontend",
    name: "App.tsx",
    language: "typescript",
  },
];

export const mockDebugContexts: DebugContext[] = [
  { id: "rust-core", label: "Rust (Core)", treeId: "rust-core", status: "paused" },
  { id: "ts-frontend", label: "TypeScript (Frontend)", treeId: "ts-frontend", status: "idle" },
  { id: "rust-standalone", label: "Rust (Standalone Test)", treeId: "rust-core", status: "idle" },
];

export const mockStackFrames: StackFrame[] = [
  { id: "f1", name: "main", location: "src/main.rs:7", isActive: true },
  { id: "f2", name: "lang_start", location: "std/rt.rs:166", isActive: false },
  { id: "f3", name: "lang_start_internal", location: "std/rt.rs:141", isActive: false },
];

export const mockBreakpoints: Breakpoint[] = [
  { id: "bp1", fileId: "rust-core/src/main.rs", location: "main.rs:7" },
  { id: "bp2", fileId: "rust-core/src/commands.rs", location: "commands.rs:12" },
];