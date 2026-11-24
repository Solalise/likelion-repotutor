import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { extensionRecordDraft } from "@/lib/security-lab/extensionReview";
import { emptyProjectReview, reviewRecordKey } from "@/lib/security-lab/projectReview";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import type { SecurityRecordKind } from "@/types/securityTestRecord";
const mocks = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), access: vi.fn(), latest: vi.fn(), records: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ currentUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { userRepository: { findMany: mocks.list }, analysisRun: { findFirst: mocks.latest }, securityTestRecord: { findMany: mocks.records } } }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: mocks.access }));
vi.mock("@/components/ui-platform/PlatformShell", () => ({ PlatformShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import Page from "./page";
const sha = "a".repeat(40), oldSha = "b".repeat(40);
const connection = { id: "service-a", repositoryId: "repo-a", deploymentVersion: 7, vercelUrl: "https://sandbox.example.org", repository: { name: "app", fullName: "org/app", htmlUrl: "https://github.com/org/app" } };
const environment: DeploymentConnectionSnapshot = { connectionId: connection.id, deploymentVersion: 7, repository: { fullName: connection.repository.fullName, htmlUrl: connection.repository.htmlUrl }, deployment: { vercelUrl: connection.vercelUrl, ownershipStatus: "UNVERIFIED", verifiedAt: null, testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
function record(kind: SecurityRecordKind, outcome: "OBSERVED" | "NOT_OBSERVED" | "INCONCLUSIVE" | "NOT_APPLICABLE", version = 7, commitSha = sha) {
  return { id: kind, revision: 1, updatedAt: "2026-11-24T01:00:00Z", repositoryFullName: "org/app", commitSha, kind, recordKey: reviewRecordKey(connection.id, version, kind), draft: extensionRecordDraft({ ...emptyProjectReview(), outcome, completed: true, expected: "Expected", observed: "Observed", evidence: "Synthetic manual test", notes: "memo" }, { ...environment, deploymentVersion: version }) };
}
async function html() { return renderToStaticMarkup(await Page()); }
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue("user"); mocks.list.mockResolvedValue([{ id: "service-a" }]); mocks.access.mockResolvedValue(connection); mocks.latest.mockResolvedValue({ commitSha: sha }); mocks.records.mockResolvedValue([]); });
it("requires login and loads only active connections owned by the user", async () => {
  mocks.user.mockResolvedValueOnce(undefined); await expect(Page()).rejects.toThrow("redirect:/login"); expect(mocks.list).not.toHaveBeenCalled();
  await html(); expect(mocks.list.mock.calls[0][0]).toMatchObject({ where: { userId: "user", active: true, removedAt: null }, select: { id: true } }); expect(mocks.access).toHaveBeenCalledWith("user", "service-a");
  expect(mocks.records.mock.calls[0][0].where).toEqual({ userId: "user", repositoryFullName: "org/app", source: "MANUAL", analysisRun: { requestedByUserId: "user", repositoryId: "repo-a" } });
});
it("shows real service metadata, four manual statuses, current date and existing detail navigation", async () => {
  mocks.records.mockResolvedValue([record("SQL_INJECTION", "OBSERVED"), record("XSS", "NOT_OBSERVED"), record("IDOR", "INCONCLUSIVE"), record("AUTHORIZATION", "NOT_APPLICABLE")]);
  const output = await html();
  for (const text of ["org/app", "<h2>app</h2>", "수동 판정 기록 4/4", "문제 관찰", "기대 동작 일치", "판정 불가", "해당 없음", "최근 검토 기록일 (현재 버전)", 'dateTime="2026-11-24T01:00:00Z"', 'href="/services/service-a/review"', "종합 검토 결과 보기"]) expect(output).toContain(text);
  expect(output).toContain("실제 검증 완료나 안전성 점수가 아닙니다"); expect(output).not.toContain("memo");
});
it("does not mix old commits or old environment scopes into card progress", async () => {
  mocks.records.mockResolvedValue([record("SQL_INJECTION", "OBSERVED"), record("XSS", "NOT_OBSERVED", 7, oldSha), record("IDOR", "INCONCLUSIVE", 6)]);
  const output = await html(); expect(output).toContain("수동 판정 기록 1/4"); expect(output).toContain("25%"); expect(output).toContain("이전 분석·별도 범위 기록 2개");
  expect(output).not.toContain("기대 동작 일치"); expect(output).not.toContain(oldSha); expect(output).toContain("미기록");
});
it("keeps denied repositories private without reporting unknown progress as zero", async () => {
  mocks.access.mockRejectedValue(new Error("private repository details")); const output = await html();
  expect(output).toContain("현재 저장소 권한을 확인하지 못해"); expect(output).not.toContain("org/app"); expect(output).not.toContain("0/4"); expect(mocks.records).not.toHaveBeenCalled();
});
it("distinguishes missing records from DB failures and does not invent a recent review date", async () => {
  const empty = await html(); expect(empty).toContain("0/4"); expect(empty).toContain("현재 버전 기록 없음"); expect(empty).not.toContain("<time");
  mocks.records.mockRejectedValueOnce(new Error("private db detail")); const failed = await html(); expect(failed).toContain("검토 기록 조회 실패"); expect(failed).not.toContain("0/4"); expect(failed).not.toContain("private db detail");
  mocks.list.mockRejectedValueOnce(new Error()); expect(await html()).toContain("서비스 목록을 조회하지 못했습니다");
});
it("groups two services into distinct cards and retains a clear start link for an empty account", async () => {
  mocks.list.mockResolvedValueOnce([{ id: "service-a" }, { id: "service-b" }]);
  mocks.access.mockImplementation(async (_user, id) => id === "service-a" ? connection : { ...connection, id, repositoryId: "repo-b", repository: { name: "second", fullName: "org/second", htmlUrl: "https://github.com/org/second" } });
  const output = await html(); expect(output).toContain('aria-label="org/app 검토 결과"'); expect(output).toContain('aria-label="org/second 검토 결과"'); expect(output).toContain('href="/services/service-b/review"');
  mocks.list.mockResolvedValueOnce([]); const empty = await html(); expect(empty).toContain("연결된 서비스가 없습니다"); expect(empty).not.toContain("내 웹서비스에서 분석·검토 시작하기");
});
