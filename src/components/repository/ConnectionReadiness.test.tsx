import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { connectionReadiness, type VercelConnectionSummary } from "@/lib/security-lab/connectionReadiness";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import type { DeploymentCommitComparison } from "@/lib/security-lab/deploymentCommit";
import { ConnectionReadiness } from "./ConnectionReadiness";

const sha = "a".repeat(40);
const snapshot: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 4, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://test.vercel.app", ownershipStatus: "VERIFIED", verifiedAt: "2026-11-24T00:00:00Z", challengeExpiresAt: null, verificationAttemptsRemaining: 5, testRequestsAllowed: false } };
const account: VercelConnectionSummary = { connectionId: "own", encryptionReady: true, connected: true, identity: { id: "user", name: "Saved account", username: "saved" }, selection: { teamId: null, projectId: "prj_saved" }, analysisCommitSha: sha, deploymentUrl: snapshot.deployment.vercelUrl };
const match: DeploymentCommitComparison = { connectionId: "own", repository: "org/app", deploymentVersion: 4, deploymentUrl: snapshot.deployment.vercelUrl, analysisRunId: "analysis", analyzedCommitSha: sha, deployedCommitSha: sha, deploymentId: "dpl_saved", projectId: "prj_saved", source: "VERCEL_API", status: "MATCH", reason: "Official metadata match", checkedAt: "2026-11-24T00:00:00Z" };

it("reuses saved connections and confirms connection checks without enabling execution", () => {
  const result = connectionReadiness("own", snapshot, account, match);
  expect(result.connectionReady).toBe(true);
  expect(result.canExecute).toBe(false);
  expect(result.checks.find(c => c.id === "execution")?.confirmed).toBe(false);
  const html = renderToStaticMarkup(<ConnectionReadiness connectionId="own" snapshot={snapshot} account={account} comparison={match} />);
  for (const value of ["org/app", "prj_saved", "https://test.vercel.app", sha]) expect(html).toContain(value);
  expect(html).toContain("연결 조건 확인 완료");
  expect(html).toContain("실제 요청 허용: 아니요");
  expect(html).not.toContain('type="password"');
});

it("explains a commit mismatch while retaining verified project/URL binding", () => {
  const mismatch = { ...match, status: "MISMATCH" as const, deployedCommitSha: "b".repeat(40), reason: "Deployment differs" };
  const result = connectionReadiness("own", snapshot, account, mismatch);
  expect(result.connectionReady).toBe(false);
  expect(result.checks.find(c => c.id === "binding")?.confirmed).toBe(true);
  expect(result.checks.find(c => c.id === "commit")?.nextAction).toContain("배포 브랜치·커밋");
  expect(result.deployedCommitSha).toBe("b".repeat(40));
});

it.each([
  { ...match, connectionId: "other" }, { ...match, repository: "org/other" }, { ...match, deploymentVersion: 3 },
  { ...match, deploymentUrl: "https://other.vercel.app" }, { ...match, projectId: "prj_other" },
  { ...match, analyzedCommitSha: "b".repeat(40) }, { ...match, analysisRunId: null },
  { ...match, source: null }, { ...match, deployedCommitSha: "b".repeat(40) },
])("never confirms a stale or unbound match", proof => {
  const result = connectionReadiness("own", snapshot, account, proof);
  expect(result.connectionReady).toBe(false);
  expect(result.checks.find(c => c.id === "commit")?.confirmed).toBe(false);
  expect(result.canExecute).toBe(false);
  expect(result.comparison?.status).not.toBe("MATCH");
});

it("shows missing ownership, analysis and lookup failure actions without requesting re-registration", () => {
  const unverified = { ...snapshot, deployment: { ...snapshot.deployment, ownershipStatus: "UNVERIFIED" as const, verifiedAt: null } };
  const result = connectionReadiness("own", unverified, { ...account, analysisCommitSha: null });
  expect(result.checks.find(c => c.id === "account")?.confirmed).toBe(true);
  expect(result.checks.find(c => c.id === "project")?.confirmed).toBe(true);
  expect(result.checks.find(c => c.id === "ownership")?.confirmed).toBe(false);
  expect(result.checks.find(c => c.id === "analysis")?.nextAction).toContain("분석");
  const failed = connectionReadiness("own", snapshot, account, { ...match, status: "LOOKUP_FAILED", reason: "Token metadata unavailable" });
  expect(failed.checks.find(c => c.id === "commit")?.detail).toBe("Token metadata unavailable");
});
