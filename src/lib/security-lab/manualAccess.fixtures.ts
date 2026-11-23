// Synthetic test fixtures only. No accounts, credentials, HTTP requests or DB access.
import { emptyAccessComparison, type AccessPlan } from "./manualAccess";
import type { ConfirmedPracticeTarget } from "@/types/securityPracticeTarget";
export const accessTestNow = Date.parse("2026-11-19T03:00:00.000Z");
export function manualAccessFixture(kind: "IDOR" | "AUTHORIZATION" = "IDOR") {
  const plan: AccessPlan = kind === "IDOR" ? { version: "manual-access-v1", kind, accounts: [{ alias: "account-A", resourceId: "item-101" }, { alias: "account-B", resourceId: "item-202" }], identifierLocation: "path id", expected: { A_OWN: "ALLOW", A_OTHER: "DENY", B_OWN: "ALLOW", B_OTHER: "DENY" } }
    : { version: "manual-access-v1", kind, roles: ["admin", "user"], operations: [{ id: "primary", name: "report", apiPath: "/api/report", method: "GET", expected: { admin: "ALLOW", user: "DENY" } }, { id: "archive", name: "archive", apiPath: "/api/report/archive", method: "POST", expected: { admin: "ALLOW", user: "DENY" } }] };
  const target: ConfirmedPracticeTarget = { apiPath: kind === "IDOR" ? "/api/items/[id]" : "/api/report", method: "GET", inputLocation: "manual", parameter: kind === "IDOR" ? "path id" : "role/operation", details: { accessPlan: JSON.stringify(plan) } };
  const binding = { repositoryFullName: "org/repo", commitSha: "a".repeat(40), recordKey: `manual:${kind}:version-1` };
  const comparison = emptyAccessComparison(target, plan, binding.commitSha);
  for (const round of [comparison.initial, comparison.retest]) { round.environmentConfirmed = true; round.performedAt = new Date(accessTestNow - 60000).toISOString(); for (const o of Object.values(round.observations)) Object.assign(o, { statusCode: 200, access: "ALLOW", responseSummary: "synthetic result included", rationale: "confirmed synthetic resource in response" }); }
  comparison.retest.commitSha = "b".repeat(40);
  return { plan, target, binding, comparison };
}
