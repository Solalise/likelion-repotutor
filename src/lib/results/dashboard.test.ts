import { beforeEach, expect, it, vi } from "vitest";
import { extensionRecordDraft } from "@/lib/security-lab/extensionReview";
import { emptyProjectReview, reviewRecordKey } from "@/lib/security-lab/projectReview";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
const mocks = vi.hoisted(() => ({ list: vi.fn(), access: vi.fn(), analysis: vi.fn(), records: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { userRepository: { findMany: mocks.list }, analysisRun: { findFirst: mocks.analysis }, securityTestRecord: { findMany: mocks.records } } }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: mocks.access }));
import { loadDashboard } from "./dashboard";
const sha = "a".repeat(40), old = "b".repeat(40);
const connection = { id: "service-a", repositoryId: "repo-a", deploymentVersion: 7, vercelUrl: "https://sandbox.example.org", repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" } };
const environment: DeploymentConnectionSnapshot = { connectionId: "service-a", deploymentVersion: 7, repository: connection.repository, deployment: { vercelUrl: connection.vercelUrl, ownershipStatus: "UNVERIFIED", verifiedAt: null, testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
function record(id: string, commitSha = sha, version = 7) {
  return { id, revision: 1, updatedAt: `2026-11-24T01:00:0${id}Z`, repositoryFullName: "org/app", commitSha, kind: "XSS", recordKey: reviewRecordKey("service-a", version, "XSS"), draft: extensionRecordDraft({ ...emptyProjectReview(), outcome: "NOT_OBSERVED", completed: true, expected: "Expected", observed: "Observed", evidence: "Synthetic manual observation", notes: "private note" }, { ...environment, deploymentVersion: version }) };
}
beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue([{ id: "service-a" }]); mocks.access.mockResolvedValue(connection); mocks.records.mockResolvedValue([]); mocks.analysis.mockImplementation(async query => query.select.status ? { status: "RUNNING" } : { commitSha: sha }); });
it("does not query personal data without login", async () => {
  expect(await loadDashboard()).toMatchObject({ signedIn: false, failed: false, services: [], recordCount: 0 }); expect(mocks.list).not.toHaveBeenCalled();
});
it("loads owner-scoped active connections and enforces repository access before reading records", async () => {
  await loadDashboard("user"); expect(mocks.list.mock.calls[0][0].where).toEqual({ userId: "user", active: true, removedAt: null }); expect(mocks.access).toHaveBeenCalledWith("user", "service-a");
  expect(mocks.records.mock.calls[0][0].where).toEqual({ userId: "user", repositoryFullName: "org/app", source: "MANUAL", analysisRun: { requestedByUserId: "user", repositoryId: "repo-a" } });
  mocks.access.mockRejectedValueOnce(new Error("forbidden")); const denied = await loadDashboard("user"); expect(denied).toMatchObject({ partial: true, services: [], recent: [] }); expect(mocks.records).toHaveBeenCalledTimes(1);
});
it("uses latest analysis status but counts only latest completed commit/environment records in progress", async () => {
  mocks.records.mockResolvedValue([record("1"), record("2", old), record("3", sha, 6)]);
  const data = await loadDashboard("user"); expect(data.recordCount).toBe(3); expect(data.services[0]).toMatchObject({ status: "RUNNING", recorded: 1, percent: 25 });
  expect(data.recent.map(row => [row.id, row.current])).toEqual([["3", false], ["2", false], ["1", true]]); expect(data.recent[0].connectionId).toBe("service-a"); expect(data.recent[0].outcome).toBe("NOT_OBSERVED"); expect(JSON.stringify(data)).not.toContain("private note");
});
it("shows a failed lookup as unknown instead of empty or zero progress", async () => {
  mocks.records.mockRejectedValueOnce(new Error("private database message")); const data = await loadDashboard("user"); expect(data).toMatchObject({ failed: false, partial: true }); expect(data.services[0]).toMatchObject({ recorded: null, percent: null, status: "조회 실패" }); expect(JSON.stringify(data)).not.toContain("private database message");
  mocks.list.mockRejectedValueOnce(new Error()); expect(await loadDashboard("user")).toMatchObject({ failed: true });
});
it("distinguishes genuinely empty data and keeps connected services with no records", async () => {
  const data = await loadDashboard("user"); expect(data).toMatchObject({ failed: false, partial: false, recordCount: 0, recent: [] }); expect(data.services[0]).toMatchObject({ recorded: 0, percent: 0 });
  mocks.list.mockResolvedValueOnce([]); expect(await loadDashboard("user")).toMatchObject({ services: [], recent: [], failed: false, partial: false });
});
it("groups two services and limits real recent records to five", async () => {
  mocks.list.mockResolvedValueOnce([{ id: "service-a" }, { id: "service-b" }]); mocks.access.mockImplementation(async (_user, id) => id === "service-a" ? connection : { ...connection, id, repositoryId: "repo-b", repository: { fullName: "org/second" } });
  mocks.records.mockImplementation(async query => query.where.repositoryFullName === "org/app" ? Array.from({ length: 6 }, (_, i) => record(String(i))) : []);
  const data = await loadDashboard("user"); expect(data.services).toHaveLength(2); expect(data.services[1]).toMatchObject({ repository: "org/second", recorded: 0 }); expect(data.recordCount).toBe(6); expect(data.recent).toHaveLength(5); expect(data.recent[0].id).toBe("5");
});
