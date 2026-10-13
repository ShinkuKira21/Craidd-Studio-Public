// Variable expansion and expression evaluation against a paused session.
// See docs/uiux/design-public-release-sweep.md §2.

export interface InspectValue { name: string; value: string; type?: string; variablesReference: number }

export async function inspectVariables(targetLabel: string | undefined, variablesReference: number): Promise<InspectValue[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const body = await invoke<{ variables?: InspectValue[] }>("debug_inspect", {
    targetLabel, command: "variables", arguments: { variablesReference },
  });
  return body.variables ?? [];
}

export async function evaluateExpression(targetLabel: string | undefined, expression: string, frameId: number | undefined,
  context: "watch" | "hover" | "repl" = "watch"): Promise<Omit<InspectValue, "name">> {
  const { invoke } = await import("@tauri-apps/api/core");
  const body = await invoke<{ result?: string; type?: string; variablesReference?: number }>("debug_inspect", {
    targetLabel, command: "evaluate", arguments: { expression, context, ...(frameId === undefined ? {} : { frameId }) },
  });
  return { value: body.result ?? "", type: body.type, variablesReference: body.variablesReference ?? 0 };
}

/** Watch expressions are stored per solution (D2). */
export function watchStorageKey(solutionPath: string | null): string {
  return `craidd:watch:${solutionPath ?? "(no solution)"}`;
}

export function readWatches(solutionPath: string | null): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(watchStorageKey(solutionPath)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

export function writeWatches(solutionPath: string | null, expressions: string[]): void {
  try { localStorage.setItem(watchStorageKey(solutionPath), JSON.stringify(expressions)); } catch { /* Best effort. */ }
}
