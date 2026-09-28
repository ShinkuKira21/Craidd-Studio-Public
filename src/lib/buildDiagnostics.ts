import { cleanOutput } from "./outputPresentation.ts";

export interface BuildProblem {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  code?: string;
}

export interface DecodedBuildLine {
  display: string | null;
  problem?: BuildProblem;
  artifact?: string;
}

function absolutePath(path: string, cwd: string): string {
  const input = path.startsWith("/") ? path : `${cwd}/${path}`;
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Keep Cargo's structured spans; the rendered text alone loses navigation. */
export function decodeBuildLine(text: string, cwd: string): DecodedBuildLine {
  text = cleanOutput(text);
  if (text.trimStart().startsWith("{")) {
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      if (value.reason === "compiler-artifact") {
        return { display: null, artifact: typeof value.executable === "string" ? value.executable : undefined };
      }
      if (value.reason === "compiler-message") {
        const message = value.message as Record<string, unknown> | undefined;
        const display = typeof message?.rendered === "string" ? cleanOutput(message.rendered)
          : typeof message?.message === "string" ? message.message : text;
        const spans = Array.isArray(message?.spans) ? message.spans as Record<string, unknown>[] : [];
        const primary = spans.find((span) => span.is_primary === true && typeof span.file_name === "string");
        const level = message?.level;
        const problem = primary && (level === "error" || level === "warning") ? {
          file: absolutePath(primary.file_name as string, cwd),
          line: Number(primary.line_start) || 1,
          column: Number(primary.column_start) || 1,
          severity: level,
          message: String(message?.message ?? "Compiler diagnostic"),
          code: typeof (message?.code as Record<string, unknown> | undefined)?.code === "string"
            ? String((message?.code as Record<string, unknown>).code) : undefined,
        } satisfies BuildProblem : undefined;
        return { display, problem };
      }
      if (["build-script-executed", "build-finished"].includes(String(value.reason))) return { display: null };
    } catch {
      // A user's command may print arbitrary text starting with '{'.
    }
  }

  const line = text.trim();
  // MSBuild: /path/Program.cs(12,8): error CS1002: Message [project.csproj]
  const csharp = line.match(/^(.+?)\((\d+)(?:,(\d+))?\):\s*(error|warning)\s+([A-Za-z]+\d+):\s*(.*?)(?:\s+\[[^\]]+\])?$/i);
  if (csharp) return { display: text, problem: {
    file: absolutePath(csharp[1], cwd), line: Number(csharp[2]), column: Number(csharp[3] ?? 1),
    severity: csharp[4].toLowerCase() as "error" | "warning", code: csharp[5], message: csharp[6],
  } };

  // Clang/GCC: /path/main.cpp:12:8: error: Message
  const cpp = line.match(/^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.*)$/i);
  if (cpp) return { display: text, problem: {
    file: absolutePath(cpp[1], cwd), line: Number(cpp[2]), column: Number(cpp[3]),
    severity: cpp[4].toLowerCase().includes("error") ? "error" : "warning", message: cpp[5],
  } };

  return { display: text };
}

/** Parked sessions can receive raw Cargo records without a renderer to decode them. */
export function formatBuildOutput(text: string): string {
  return cleanOutput(text).split("\n").flatMap((line) => {
    const decoded = decodeBuildLine(line, "");
    return decoded.display === null ? [] : [decoded.display.replace(/\n+$/, "")];
  }).join("\n");
}

export function appendBuildProblem(problems: BuildProblem[], problem: BuildProblem): BuildProblem[] {
  if (problems.some((old) => old.file === problem.file && old.line === problem.line && old.column === problem.column
    && old.severity === problem.severity && old.message === problem.message && old.code === problem.code)) return problems;
  return [...problems, problem].slice(-500);
}
