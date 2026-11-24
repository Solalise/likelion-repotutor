import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { SavedRecord } from "@/components/results/RecordPersistence";
import { emptyProjectReview, reviewRecordKey } from "@/lib/security-lab/projectReview";
import { extensionRecordDraft } from "@/lib/security-lab/extensionReview";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import type { SecurityRecordKind } from "@/types/securityTestRecord";
import { summarizeManualRecords, summaryProgress } from "@/lib/results/reviewSummary";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), latest: vi.fn(), records: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ currentUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { analysisRun: { findFirst: mocks.latest }, securityTestRecord: { findMany: mocks.records } } }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: mocks.access, RepositoryAccessError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
vi.mock("@/lib/repository/githubAnalysisCache", () => ({ getGithubAnalysisCache: mocks.cache, githubAnalysisCacheKey: (...args: string[]) => args.join(":") }));
vi.mock("@/components/ui-platform/PlatformShell", () => ({ PlatformShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
import Page from "./page";
import { RepositoryAccessError } from "@/lib/github/repositoryAccess";
const sha = "a".repeat(40), oldSha = "b".repeat(40);
const environment: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 7, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://sandbox.example.org", ownershipStatus: "UNVERIFIED", verifiedAt: null, testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
function record(kind: SecurityRecordKind, outcome: "OBSERVED" | "NOT_OBSERVED" | "INCONCLUSIVE" | "NOT_APPLICABLE" | "UNSET", options: { sha?: string; env?: typeof environment; id?: string; notes?: string; updatedAt?: string } = {}): SavedRecord {
  const env = options.env ?? environment;
  return { id: options.id ?? kind, revision: 1, repositoryFullName: "org/app", commitSha: options.sha ?? sha, kind, recordKey: reviewRecordKey(env.connectionId, env.deploymentVersion, kind), updatedAt: options.updatedAt ?? "2026-11-24T00:00:00Z",
    draft: extensionRecordDraft({ ...emptyProjectReview(), completed: true, outcome, expected: "Expected synthetic behavior", observed: "Observed synthetic result", evidence: "Manual code review and approved synthetic test", notes: options.notes ?? "User memo", codeLocation: "src/query.ts:9" }, env) };
}
const args = (commit?: string) => ({ params: Promise.resolve({ connectionId: "own" }), searchParams: Promise.resolve({ commit }) });
async function html(commit?: string) { return renderToStaticMarkup(await Page(args(commit))); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue("user-1");
  mocks.access.mockResolvedValue({ id: "own", repositoryId: "repo-1", repository: { fullName: "org/app" }, installation: { installationId: "42" }, deploymentVersion: 7, vercelUrl: "https://sandbox.example.org" });
  mocks.latest.mockResolvedValue({ commitSha: sha }); mocks.records.mockResolvedValue([]); mocks.cache.mockReturnValue(undefined);
});
it("requires login and current repository access before querying or rendering private records", async () => {
  mocks.user.mockResolvedValueOnce(undefined); await expect(Page(args())).rejects.toThrow("redirect:/login"); expect(mocks.records).not.toHaveBeenCalled();
  mocks.access.mockRejectedValueOnce(new RepositoryAccessError("denied", 403)); expect(await html()).toContain("저장소 접근 권한을 확인하지 못했습니다"); expect(mocks.records).not.toHaveBeenCalled();
  mocks.access.mockRejectedValueOnce(new RepositoryAccessError("missing", 404)); await expect(Page(args())).rejects.toThrow("NOT_FOUND");
});
it("filters DB access by user, repository, manual source and owning analysis run", async () => {
  await html();
  expect(mocks.access).toHaveBeenCalledWith("user-1", "own");
  expect(mocks.records).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", repositoryFullName: "org/app", source: "MANUAL", analysisRun: { requestedByUserId: "user-1", repositoryId: "repo-1" } } }));
  expect(mocks.latest.mock.calls[0][0].where).toMatchObject({ requestedByUserId: "user-1", repositoryId: "repo-1", status: "COMPLETED", source: "CONNECTED_REPOSITORY" });
});
it("shows four saved manual outcomes and a record progress count without declaring security completion", async () => {
  mocks.records.mockResolvedValue([record("SQL_INJECTION", "OBSERVED"), record("XSS", "NOT_OBSERVED"), record("IDOR", "INCONCLUSIVE"), record("AUTHORIZATION", "NOT_APPLICABLE")]);
  const output = await html();
  for (const label of ["문제 관찰", "기대 동작 일치", "판정 불가", "해당 없음", "수동 판정 기록 4/4", "Expected synthetic behavior", "Observed synthetic result", "Manual code review and approved synthetic test", "User memo", "src/query.ts:9"]) expect(output).toContain(label);
  expect(output).toContain("실제 보안 검증 완료나 사이트 전체의 안전성을 뜻하지 않습니다");
  expect(output).not.toContain("수정 전후 비교"); expect(output).not.toContain("AI 코드 수정");
});
it("distinguishes missing records from a DB failure", async () => {
  const empty = await html(); expect(empty).toContain("수동 판정 기록 0/4"); expect(empty).toContain("미기록");
  mocks.records.mockRejectedValueOnce(new Error("private database detail")); const failed = await html();
  expect(failed).toContain("미기록으로 처리하지 않으며"); expect(failed).not.toContain("0/4"); expect(failed).not.toContain("private database detail");
});
it("separates previous commits and environment versions without copying them into current progress", async () => {
  const oldEnvironment = { ...environment, deploymentVersion: 6 };
  mocks.records.mockResolvedValue([record("XSS", "OBSERVED", { sha: oldSha, notes: "OLD-COMMIT-MEMO" }), record("IDOR", "INCONCLUSIVE", { env: oldEnvironment, notes: "OLD-ENV-MEMO" })]);
  const output = await html(); expect(output).toContain("수동 판정 기록 0/4"); expect(output).toContain("이전 환경 버전 6"); expect(output).toContain("OLD-ENV-MEMO"); expect(output).not.toContain("OLD-COMMIT-MEMO"); expect(output).toContain(`?commit=${oldSha}`);
  const previous = await html(oldSha); expect(previous).toContain("이전 분석 기록"); expect(previous).toContain("OLD-COMMIT-MEMO"); expect(previous).toContain("현재 분석 커밋으로 돌아가기");
  await expect(Page(args("c".repeat(40)))).rejects.toThrow("NOT_FOUND");
});
it("uses the latest saved outcome but preserves older details and legacy individual records", async () => {
  const latest = record("XSS", "UNSET", { id: "new", updatedAt: "2026-11-24T01:00:00Z" }), older = record("XSS", "OBSERVED", { id: "old" });
  const normalized = summarizeManualRecords([older, latest], { connectionId: "own", repository: "org/app", environmentVersion: 7, site: "https://sandbox.example.org" });
  expect(summaryProgress(normalized.records).recorded).toBe(0); expect(normalized.records).toHaveLength(2);
  const legacy = record("SQL_INJECTION", "OBSERVED", { id: "legacy" }); legacy.recordKey = "legacy-individual-record"; legacy.draft.memo = "Legacy manual memo";
  mocks.records.mockResolvedValue([legacy]); const output = await html(); expect(output).toContain("환경 버전 미확인 개별 기록"); expect(output).toContain("Legacy manual memo");
  expect(summarizeManualRecords([{ ...older, recordKey: reviewRecordKey("other-connection", 7, "XSS") }], { connectionId: "own", repository: "org/app", environmentVersion: 7, site: "https://sandbox.example.org" }).records).toHaveLength(0);
});
it("shows static evidence separately only from the exact selected commit and keeps manual records when cache expires", async () => {
  mocks.records.mockResolvedValue([record("SQL_INJECTION", "NOT_OBSERVED")]);
  const analysis = { repository: "org/app", collection: { commitSha: sha }, files: [{ path: "src/query.ts", sourceCode: "\n".repeat(8) + "db.query(sql);" }], sqlInjection: { findings: [{ id: "static-1", type: "SQL_INJECTION", filePath: "src/query.ts", line: 9, code: "db.query(sql);", reason: "STATIC-REFERENCE-ONLY", evidence: [] }], coverage: { status: "completed" } } };
  mocks.cache.mockReturnValueOnce(analysis); const output = await html(); expect(output).toContain("STATIC-REFERENCE-ONLY"); expect(output).toContain("시스템 정적 분석 참고"); expect(output).toContain("기대 동작 일치"); expect(output).toContain("해당 커밋 코드 발췌");
  mocks.cache.mockReturnValueOnce({ ...analysis, collection: { commitSha: oldSha } }); const mismatch = await html(); expect(mismatch).not.toContain("STATIC-REFERENCE-ONLY"); expect(mismatch).toContain("캐시 없음"); expect(mismatch).toContain("Observed synthetic result");
});
