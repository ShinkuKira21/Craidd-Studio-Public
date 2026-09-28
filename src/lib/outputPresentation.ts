/** Output is a text pane, not a terminal: remove styling/cursor commands. */
export function cleanOutput(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n").map((line) => line.split("\r").pop() ?? "").join("\n");
}

/** Cargo's rendered blocks already include a newline; don't add another. */
export function appendOutput(previous: string, text: string): string {
  const cleaned = cleanOutput(text).replace(/\n+$/, "");
  return cleaned ? (previous + cleaned + "\n").slice(-150_000) : previous;
}

export function isAtOutputBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 24;
}
