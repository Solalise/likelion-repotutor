import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), sync: vi.fn(), access: vi.fn(), redirect: vi.fn(), refresh: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { userRepository: { findMany: mocks.list } } }));
vi.mock("@/lib/github/installations", () => ({ syncAllUserInstallations: mocks.sync }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: mocks.access }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: mocks.refresh }), usePathname: () => "/services" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import Page from "./page";
import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { requestServiceAnalysis } from "@/components/services/ServiceAnalysis";
import RepositoryPage from "@/app/repository/page";
import RepositoriesPage from "@/app/repositories/page";
import LegacyPage from "@/app/legacy/learning/page";

const params = (connected?: string) => ({ searchParams: Promise.resolve({ connected }) });
function html(element: ReactElement) { return renderToStaticMarkup((element.props as { children: ReactElement }).children); }
beforeEach(() => { vi.resetAllMocks(); mocks.sync.mockResolvedValue(0); mocks.access.mockResolvedValue({}); mocks.list.mockResolvedValue([]); });

it("uses the VulnLab shell and existing login without loading private services for guests", async () => {
  mocks.auth.mockResolvedValue(null);
  const element = await Page(params()); const markup = html(element);
  expect(element.type).toBe(PlatformShell);
  expect(markup).toContain("GitHub 로그인으로 시작");
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  expect(markup).not.toContain("실행기 페어링");
  expect(markup).not.toContain("함수 그래프");
});

it.each([true, false])("keeps analysis/preparation accessible independently of saved deployment state (%s)", registered => {
  return checkBasicFlow(registered);
});

async function checkBasicFlow(registered: boolean) {
  mocks.auth.mockResolvedValue({ user: { id: "user-a" } });
  mocks.list.mockResolvedValue([{ id: "connection-a", vercelUrl: registered ? "https://test.vercel.app" : null, deploymentOwnershipStatus: registered ? "VERIFIED" : "UNVERIFIED", deploymentVerifiedAt: registered ? new Date() : null, installation: { suspendedAt: null }, repository: { fullName: "org/app", defaultBranch: "main", analysisRuns: [{ status: "COMPLETED", stats: { sqlInjection: { candidates: 99 } }, sourceCode: "SECRET_FINDING_PATH" }] } }]);
  const markup = html(await Page(params("connection-a")));
  expect(mocks.sync).toHaveBeenCalledWith("user-a");
  expect(mocks.access).toHaveBeenCalledWith("user-a", "connection-a");
  expect(mocks.list.mock.calls[0][0].where).toEqual({ userId: "user-a", active: true, removedAt: null });
  expect(markup).toContain("org/app"); expect(markup).not.toContain("https://test.vercel.app");
  for (const obsolete of ["Vercel", "Access Token", "배포 URL 연결 필요", "사이트 소유권 확인", "배포 커밋", "practice-readiness"]) expect(markup).not.toContain(obsolete);
  expect(markup).toContain("분석 완료");
  expect(markup).not.toContain("SECRET_FINDING_PATH"); expect(markup).toContain("분석 결과 조회");
  expect(markup).toContain("프로젝트별 보안 검증 가이드");
  expect(markup).toContain("정적 후보가 없어도 검토 가능");
  expect(markup).not.toContain('href="/practice"');
  expect(markup).not.toContain('href="/security-lab/project"');
  mocks.access.mockRejectedValue(new Error("denied"));
  const denied = html(await Page(params("other-user-connection")));
  expect(denied).not.toContain("org/app"); expect(denied).not.toContain("Vercel 계정 및 프로젝트 연결");
}

it("requests a receipt, rejects full analysis, and retires old learning entry points", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "analysis-complete", commitSha: "sha", findings: ["PRIVATE"] }));
  expect(await requestServiceAnalysis("own-connection", fetcher)).toEqual({ status: "analysis-complete", commitSha: "sha" });
  expect(fetcher.mock.calls[0][1].headers.Accept).toBe("application/vnd.repotutor.analysis-receipt+json");
  fetcher.mockResolvedValue(Response.json({ files: ["PRIVATE"] }));
  await expect(requestServiceAnalysis("own-connection", fetcher)).rejects.toThrow("완료 상태");
  mocks.redirect.mockImplementation((url: string) => { throw new Error(url); });
  await expect(RepositoryPage(params("connection-a"))).rejects.toThrow("/services?connected=connection-a");
  expect(() => RepositoriesPage()).toThrow("/services"); expect(() => LegacyPage()).toThrow("/services");
});
