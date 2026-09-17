import type { ConfigEntry, ConfigKind, ConfigOrigin } from "../../../../types/project";

export const KINDS: { id: ConfigKind; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
  { id: "test", label: "Test" },
];

export const METHODS: { id: string; label: string; available: boolean }[] = [
  { id: "cargo", label: "Cargo (Rust)", available: true },
  { id: "npm", label: "npm (Node)", available: false },
  { id: "dotnet", label: ".NET", available: false },
  { id: "cmake", label: "CMake (C++)", available: false },
  { id: "shell", label: "Shell", available: false },
  { id: "composed", label: "Composed", available: false },
  { id: "python", label: "Python", available: false },
];

export function methodLabel(id: string | undefined): string {
  return METHODS.find((m) => m.id === id)?.label ?? (id ?? "—");
}

export function emptyConfigForProject(target: string): ConfigEntry {
  return {
    name: "New Configuration",
    kind: "run",
    target,
    method: "cargo",
    command: "",
    cwd: undefined,
    origin: "user" as ConfigOrigin,
    profiles: [],
    defaultProfile: undefined,
  };
}

export function originLabel(o: ConfigOrigin): string {
  return o === "user" ? "user" : "inferred";
}
