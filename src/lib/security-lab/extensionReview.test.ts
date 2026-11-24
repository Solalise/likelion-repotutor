import { expect, it } from "vitest";
import { extensionObservation, extensionSession, extensionRecordDraft } from "./extensionReview";
import { emptyProjectReview, reviewFromRecord } from "./projectReview";
import { parseRecord } from "@/lib/results/validation";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { DeploymentConnectionSnapshot } from "./findingPreparation";
const analysis: RepositoryAnalysis = { repository: "org/app", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 }, collection: { source: "github", commitSha: "a".repeat(40), discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, partial: false, durationMs: 0 } };
const environment: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 7, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://sandbox.example.org", ownershipStatus: "VERIFIED", verifiedAt: "2026-11-24T00:00:00Z", testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
it("binds four zero-candidate guides to repository, SHA and verified environment version without execution authority", () => {
  const session = extensionSession(analysis, environment);
  expect(session.guides.map(g => g.kind)).toEqual(["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"]);
  expect(session.guides.every(g => g.candidates === 0 && g.snippets.length === 0 && g.procedure.length > 0)).toBe(true);
  expect(session.id).toContain(analysis.collection!.commitSha);
  expect(extensionSession(analysis, { ...environment, deploymentVersion: 8 }).id).not.toBe(session.id);
  expect(session).not.toHaveProperty("testRequestsAllowed");
  expect(JSON.stringify(session)).not.toContain("/api/orders");
});
it("allows unverified and unregistered sites but rejects mismatched repository or missing commit contexts", () => {
  expect(extensionSession(analysis, { ...environment, deployment: { ...environment.deployment, ownershipStatus: "UNVERIFIED", verifiedAt: null } }).guides).toHaveLength(4);
  expect(extensionSession(analysis, { ...environment, deployment: { ...environment.deployment, vercelUrl: null, ownershipStatus: "UNVERIFIED", verifiedAt: null } }).site).toBeNull();
  expect(() => extensionSession({ ...analysis, repository: "other/repo" }, environment)).toThrow();
  expect(() => extensionSession({ ...analysis, collection: undefined }, environment)).toThrow();
});
it("saves manual observations without a registered site and never credits verification completion", () => {
  const draft = extensionRecordDraft({ ...emptyProjectReview(), completed: true, outcome: "NOT_OBSERVED", expected: "Safe output", observed: "Text only", evidence: "Manual review" }, { ...environment, deployment: { ...environment.deployment, vercelUrl: null, ownershipStatus: "UNVERIFIED", verifiedAt: null } });
  const parsed = parseRecord({ repositoryFullName: analysis.repository, commitSha: analysis.collection!.commitSha, recordKey: "manual", kind: "XSS", draft });
  expect(parsed.draft.targetSnapshot?.deploymentUrl).toBeUndefined();
  expect(reviewFromRecord(parsed.draft)?.completed).toBe(false);
  expect(JSON.parse(parsed.draft.memo)).toMatchObject({ completed: false, recordMode: "manual-observation", executionApproved: false });
});
it("accepts valid manual records only, with not-applicable reasons and bounded input", () => {
  const review = { ...emptyProjectReview(), completed: true, outcome: "NOT_APPLICABLE" as const, expected: "No SQL", observed: "No SQL usage", evidence: "dependency review", notes: "MongoDB only" };
  expect(extensionObservation({ kind: "SQL_INJECTION", review }).review).toEqual(review);
  for (const patch of [{ notes: "" }, { completed: false }, { expected: "" }, { observed: "x".repeat(2001) }, { outcome: "OTHER" }]) expect(() => extensionObservation({ kind: "SQL_INJECTION", review: { ...review, ...patch } })).toThrow();
  expect(() => extensionObservation({ kind: "OTHER", review })).toThrow();
  expect(() => extensionObservation({ kind: "XSS", review: { ...review, evidence: "Authorization: Bearer synthetic-secret-token" } })).toThrow();
});
