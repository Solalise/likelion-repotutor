import { describe, expect, it } from "vitest";
import { accessCases, assessAccess, observedAccess, accessRoundComplete, accessPairDifferences, containsCredentialMaterial, parseAccessPlan, parseAccessComparison, parseAccessImport, accessImportTemplate } from "./manualAccess";
import { manualAccessFixture, accessTestNow } from "./manualAccess.fixtures";
import { emptySecurityRecord, validateManualRetest } from "@/types/securityTestRecord";

describe("manual access policy comparison", () => {
  it("uses the canonical structured UTC timestamp instead of interpreting display time in the server timezone", () => {
    const f = manualAccessFixture();
    const draft = { ...emptySecurityRecord({ apiPath: f.target.apiPath, method: f.target.method, targetSnapshot: f.target }), inspectionMethod: "manual", beforeObservation: "before", changedFiles: "route.ts", changes: "access policy", retestMethod: "manual", afterObservation: "after", afterStatus: "INCONCLUSIVE" as const, performedManually: true, performedAt: "2026-11-19T11:59", accessComparison: f.comparison };
    expect(validateManualRetest(draft, accessTestNow).errors.performedAt).toBeUndefined();
    f.comparison.retest.performedAt = new Date(accessTestNow + 1000).toISOString(); expect(validateManualRetest(draft, accessTestNow).errors.performedAt).toContain("미래");
  });
  it("creates all four owner/cross-owner IDOR cases and a role-by-operation matrix", () => {
    const idor = manualAccessFixture(); const rows = accessCases(idor.plan, idor.target);
    expect(rows.map(r => [r.actor, r.owner, r.resource, r.expected])).toEqual([["account-A", "account-A", "item-101", "ALLOW"], ["account-A", "account-B", "item-202", "DENY"], ["account-B", "account-B", "item-202", "ALLOW"], ["account-B", "account-A", "item-101", "DENY"]]);
    const auth = manualAccessFixture("AUTHORIZATION"); expect(accessCases(auth.plan, auth.target)).toMatchObject([{ actor: "admin", method: "GET", expected: "ALLOW" }, { actor: "user", expected: "DENY" }, { actor: "admin", method: "POST" }, { actor: "user", method: "POST", expected: "DENY" }]);
  });
  it("does not infer access from 200/403 and requires a manual conclusion plus evidence metadata", () => {
    const f = manualAccessFixture(), round = f.comparison.initial, observation = round.observations.A_OTHER;
    expect(observedAccess(round, observation, accessTestNow)).toBe("ALLOW");
    expect(assessAccess("DENY", "ALLOW")).toBe("SUSPECTED_VIOLATION"); expect(assessAccess("ALLOW", "DENY")).toBe("UNEXPECTED_DENIAL"); expect(assessAccess("DENY", "DENY")).toBe("MATCH");
    expect(observedAccess(round, { ...observation, access: "UNKNOWN", statusCode: 200 }, accessTestNow)).toBe("UNKNOWN");
    expect(observedAccess(round, { ...observation, access: "DENY", statusCode: 200 }, accessTestNow)).toBe("DENY");
    expect(observedAccess(round, { ...observation, access: "ALLOW", statusCode: 403 }, accessTestNow)).toBe("ALLOW");
    for (const changed of [{ ...round, environmentConfirmed: false }, { ...round, performedAt: "" }, { ...round, commitSha: "unknown" }]) expect(observedAccess(changed, observation, accessTestNow)).toBe("UNKNOWN");
    expect(observedAccess(round, { ...observation, rationale: "" }, accessTestNow)).toBe("UNKNOWN");
    expect(observedAccess(round, { ...observation, statusCode: 5 }, accessTestNow)).toBe("UNKNOWN");
  });
  it("records inconclusive results without manufacturing success and computes summary differences only", () => {
    const f = manualAccessFixture(); const o = f.comparison.initial.observations.A_OTHER;
    Object.assign(o, { statusCode: null, access: "UNKNOWN", responseSummary: "no HTTP response", rationale: "timeout in isolated test environment" });
    expect(accessRoundComplete(f.comparison.initial, accessTestNow)).toBe(true); expect(assessAccess("DENY", observedAccess(f.comparison.initial, o, accessTestNow))).toBe("UNKNOWN");
    expect(accessPairDifferences(f.plan, f.target, f.comparison.initial)[0]).toMatchObject({ statusChanged: null, summaryChanged: true });
    expect(parseAccessComparison(f.comparison, f.target, f.plan, f.binding.commitSha, accessTestNow)).toEqual(f.comparison);
  });
  it("rejects shared accounts/resources, role overlap, unknown policy entries and external operation URLs", () => {
    const f = manualAccessFixture(); if (f.plan.kind !== "IDOR") throw new Error();
    const idorPlan = f.plan;
    expect(() => parseAccessPlan({ ...idorPlan, accounts: [idorPlan.accounts[0], idorPlan.accounts[0]] }, f.target, "IDOR")).toThrow();
    const a = manualAccessFixture("AUTHORIZATION"); if (a.plan.kind !== "AUTHORIZATION") throw new Error();
    for (const changed of [{ ...a.plan, roles: ["admin", "admin"] }, { ...a.plan, roles: ["admin", "__proto__"] }, { ...a.plan, operations: [{ ...a.plan.operations[0], apiPath: "https://outside.invalid/api" }] }, { ...a.plan, operations: [{ ...a.plan.operations[0], expected: { admin: "ALLOW", user: "DENY", other: "ALLOW" } }] }]) expect(() => parseAccessPlan(changed, a.target, "AUTHORIZATION")).toThrow();
  });
  it("binds imported observations to repository, SHA, target version, case IDs and phase", () => {
    const f = manualAccessFixture(), payload = accessImportTemplate(f.binding, f.target, "initial", f.comparison.initial);
    expect(parseAccessImport(JSON.stringify(payload), f.binding, f.target, f.plan, "initial", accessTestNow)).toEqual(f.comparison.initial);
    for (const changed of [{ ...payload, commitSha: "b".repeat(40) }, { ...payload, repositoryFullName: "other/repo" }, { ...payload, recordKey: "new-version" }, { ...payload, phase: "retest" }, { ...payload, targetIdentity: "other-target" }, { ...payload, headers: {} }, { ...payload, round: { ...payload.round, observations: {} } }]) expect(() => parseAccessImport(JSON.stringify(changed), f.binding, f.target, f.plan, "initial", accessTestNow)).toThrow();
    expect(() => parseAccessComparison({ ...f.comparison, initial: { ...f.comparison.initial, commitSha: "b".repeat(40) } }, f.target, f.plan, f.binding.commitSha, accessTestNow)).toThrow();
    expect(() => parseAccessComparison({ ...f.comparison, retest: { ...f.comparison.retest, performedAt: new Date(accessTestNow + 1000).toISOString() } }, f.target, f.plan, f.binding.commitSha, accessTestNow)).toThrow();
    expect(() => parseAccessComparison({ ...f.comparison, retest: { ...f.comparison.retest, performedAt: new Date(accessTestNow - 120000).toISOString() } }, f.target, f.plan, f.binding.commitSha, accessTestNow)).toThrow();
  });
  it("rejects credential fields and recognizable credential material instead of preserving raw HTTP", () => {
    for (const value of ["Authorization: Bearer fixture", "Cookie: session=fixture", '{"Cookie":"session=fixture"}', '{"password":"fixture"}', '{"token":"fixture"}', "access_token=fixture", "https://user:fixture@example.invalid/"]) expect(containsCredentialMaterial(value)).toBe(true);
    const f = manualAccessFixture(); f.comparison.initial.observations.A_OWN.responseSummary = "Set-Cookie: fixture=secret";
    expect(() => parseAccessComparison(f.comparison, f.target, f.plan, f.binding.commitSha, accessTestNow)).toThrow();
    const p = accessImportTemplate(f.binding, f.target, "initial", f.comparison.initial);
    expect(() => parseAccessImport(JSON.stringify(p), f.binding, f.target, f.plan, "initial", accessTestNow)).toThrow();
  });
});
