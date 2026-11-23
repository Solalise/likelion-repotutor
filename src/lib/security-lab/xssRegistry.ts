import "server-only";
import type { ManagedSqliTarget, SqliExecutionApproval } from "./sqliRegistry";
export type ManagedXssTarget = ManagedSqliTarget & { reflectionLocation: string; reflectionContext: "HTML_TEXT" | "HTML_ATTRIBUTE" | "UNKNOWN" };
/** Separate operator-reviewed grants; SQLi ownership/approval never grants XSS permission. */
export function managedXssRegistry(): { target: ManagedXssTarget | null; approvals: readonly SqliExecutionApproval[] } {
  return { target: null, approvals: [] };
}
