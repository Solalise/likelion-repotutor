import "server-only";

export type ManagedSqliTarget = {
  id: string; origin: string; path: string; method: "GET"; parameter: string;
  projectId: string; deploymentId: string;
  isolatedTestOnly: true; syntheticDataOnly: true; readOnlyDatabase: true; sideEffectFreeApi: true;
  reviewReference: string;
  reflectionLocation?: string; reflectionContext?: "HTML_TEXT" | "HTML_ATTRIBUTE" | "UNKNOWN";
};
export type SqliExecutionApproval = {
  id: string; targetId: string; userId: string; connectionId: string; analysisRunId: string;
  repository: string; commitSha: string; findingId: string; deploymentVersion: number;
  issuedAt: string; expiresAt: string; maxRequests: number;
};

/** Operator-reviewed deployment configuration only. No browser registration or arbitrary URL fallback.
 * No managed test site has been provisioned/verified in this workspace. Keep this EMPTY.
 * Register at most one immutable preview deployment only after the checks in docs/sqli-execution-mvp.md.
 */
export function managedSqliRegistry(): { target: ManagedSqliTarget | null; approvals: readonly SqliExecutionApproval[] } {
  return { target: null, approvals: [] };
}
