import { expect, it } from "vitest";
import { parseRecord } from "@/lib/results/validation";
import { emptyProjectReview, projectGuideEvidence, reviewContentComplete, reviewFromRecord, reviewKinds, reviewProgress, reviewRecordDraft, reviewRecordKey, confirmedReviewEnvironment } from "./projectReview";
import type { DeploymentConnectionSnapshot } from "./findingPreparation";
import type { RepositoryAnalysis } from "@/types/analysis";
const environment: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 3, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://sandbox.example.org", ownershipStatus: "VERIFIED", verifiedAt: "2026-11-24T00:00:00Z", testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
const complete = { ...emptyProjectReview(), completed: true, outcome: "NOT_OBSERVED" as const, expected: "Denied according to test policy", observed: "Denied in synthetic test", notes: "User observation only", evidence: "test-run-1", codeLocation: "app/actions.ts:4" };

it("keeps every guide available when all static reports are empty or missing", () => {
  const a: RepositoryAnalysis = { repository: "org/app", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 } };
  for (const kind of reviewKinds) expect(projectGuideEvidence(a, kind).findings).toEqual([]);
  expect(reviewKinds).toHaveLength(4);
});
it("round-trips four manual review types through the EXISTING record validator without retest claims", () => {
  for (const kind of reviewKinds) {
    const draft = reviewRecordDraft(complete, environment);
    const input = { repositoryFullName: "org/app", commitSha: "a".repeat(40), recordKey: reviewRecordKey("own", 3, kind), kind, draft };
    const parsed = parseRecord(input);
    expect(reviewFromRecord(parsed.draft)).toEqual(complete);
    expect(parsed.draft.retestStatus).toBe("NOT_STARTED");
    expect(parsed.draft.performedManually).toBe(false);
    expect(parsed.draft.targetSnapshot?.details?.scope).toContain("API 추정 아님");
  }
});
it("counts manual completion separately from no findings and preserves not-applicable reasons", () => {
  const reviews = Object.fromEntries(reviewKinds.map(kind => [kind, emptyProjectReview()])) as Record<typeof reviewKinds[number], typeof complete>;
  expect(reviewProgress(reviews)).toEqual({ completed: 0, percent: 0 });
  reviews.SQL_INJECTION = complete;
  expect(reviewProgress(reviews)).toEqual({ completed: 1, percent: 25 });
  const notApplicable = { ...complete, outcome: "NOT_APPLICABLE" as const, notes: "No SQL found in reviewed scope" };
  expect(reviewFromRecord(reviewRecordDraft(notApplicable, environment))?.outcome).toBe("NOT_APPLICABLE");
  expect(reviewContentComplete({ ...notApplicable, notes: "" })).toBe(false);
  expect(reviewContentComplete({ ...complete, evidence: "" })).toBe(false);
});
it("binds the review scope to the connection/environment version without granting execution", () => {
  expect(confirmedReviewEnvironment("own", environment)).toBe(true);
  expect(confirmedReviewEnvironment("other", environment)).toBe(false);
  expect(confirmedReviewEnvironment("own", { ...environment, deployment: { ...environment.deployment, ownershipStatus: "UNVERIFIED" } })).toBe(false);
  expect(reviewRecordKey("own", 3, "XSS")).not.toBe(reviewRecordKey("own", 4, "XSS"));
  expect(environment.deployment.testRequestsAllowed).toBe(false);
});
it("does not credit empty, malformed or credential-bearing manual records", () => {
  expect(reviewFromRecord({ ...reviewRecordDraft(complete, environment), memo: "not-json" })).toBeNull();
  expect(reviewContentComplete({ ...complete, evidence: "Authorization: Bearer secret" })).toBe(false);
  expect(reviewFromRecord(reviewRecordDraft({ ...complete, observed: "" }, environment))?.completed).toBe(false);
});
