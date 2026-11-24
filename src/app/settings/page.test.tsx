import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.profile } } }));
vi.mock("@/components/ui-platform/PlatformShell", () => ({
  PlatformShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/auth/AuthButtons", () => ({
  SignInButton: ({ redirectTo }: { redirectTo: string }) => <button data-return-to={redirectTo}>GitHub로 로그인</button>,
  SignOutButton: () => <button>로그아웃</button>,
}));
import Page from "./page";

beforeEach(() => vi.resetAllMocks());

it("shows signed-out status and the existing login action without reading another user's profile", async () => {
  mocks.auth.mockResolvedValue(null);
  const html = renderToStaticMarkup(await Page());
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(html).toContain("로그인하지 않았습니다");
  expect(html).toContain('data-return-to="/settings"');
  expect(html).not.toContain('href="/api/github/installations/start"');
  expect(html).not.toContain("현재 GitHub API와 연결하지 않습니다");
});

it("uses the authenticated user's GitHub metadata and preserves existing connection routes", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-a", name: "사용자 A" } });
  mocks.profile.mockResolvedValue({ githubLogin: "octocat", accounts: [{ id: "github-account" }], _count: { installations: 1 } });
  const html = renderToStaticMarkup(await Page());
  expect(mocks.profile).toHaveBeenCalledWith({
    where: { id: "user-a" },
    select: { githubLogin: true, accounts: { where: { provider: "github" }, select: { id: true } }, _count: { select: { installations: true } } },
  });
  expect(html).toContain("로그인됨");
  expect(html).toContain("octocat");
  expect(html).toContain("로그아웃");
  expect(html).toContain('href="/services"');
  expect(html).not.toContain('href="/api/github/installations/start"');
  expect(html).toContain("현재 접근 권한은 내 웹서비스에서 다시 확인");
  expect(html).not.toContain("Vercel");
});

it("does not mistake a session or a Vercel connection for a GitHub account", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-a", name: "사용자 A" } });
  mocks.profile.mockResolvedValue({ githubLogin: null, accounts: [], _count: { installations: 0 } });
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("GitHub 계정 연결 기록을 찾지 못했습니다");
  expect(html).not.toContain('href="/api/github/installations/start"');
});
