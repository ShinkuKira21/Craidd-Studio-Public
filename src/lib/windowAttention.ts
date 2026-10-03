import type { LinkedMember, LinkedSnapshot } from "../store/linkedWindowsStore";

export type WindowAttention = "error" | "paused" | null;

export function windowAttention(
  item: Pick<LinkedMember, "windowLabel" | "status" | "restoring" | "failureMessage">,
  problems: LinkedSnapshot["problems"],
): WindowAttention {
  if (item.status === "error" || item.status === "failed" || item.failureMessage
    || problems.some((problem) => problem.windowLabel === item.windowLabel && problem.severity === "error")) return "error";
  if (!item.restoring && item.status === "paused") return "paused";
  return null;
}
