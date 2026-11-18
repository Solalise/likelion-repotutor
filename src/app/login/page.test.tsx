import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), redirect: vi.fn(), pathname: "/login" }));
vi.mock("@/auth", () => ({ auth: mocks.auth, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, redirect: mocks.redirect }));
import LoginPage from "./page";
import { PlatformFrame } from "@/components/ui-platform/PlatformFrame";

beforeEach(() => { vi.resetAllMocks(); mocks.pathname = "/login"; });

it("reuses the dashboard shell and keeps learning and practice available to guests", async () => {
  mocks.auth.mockResolvedValue(null);
  const html = renderToStaticMarkup(await LoginPage());
  for (const className of ["vl-shell", "vl-sidebar", "vl-topbar", "vl-card"]) expect(html).toContain(className);
  expect(html).toContain('id="main-content"');
  expect(html).toContain("GitHub로 로그인");
  expect(html).toContain('href="/learn"');
  expect(html).toContain('href="/practice"');
  expect(html).not.toContain('href="/services"');
  expect(html).not.toContain('href="/results"');
  expect(html.match(/title="로그인 후 이용할 수 있습니다"/g)).toHaveLength(2);
  expect(html).not.toContain('class="app-header"');
});

it("preserves the authenticated user's dashboard redirect", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-a" } });
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
  await expect(LoginPage()).rejects.toThrow("REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
});

it("does not change navigation outside the guest login page", () => {
  mocks.pathname = "/learn";
  const html = renderToStaticMarkup(<PlatformFrame><p>학습</p></PlatformFrame>);
  expect(html).toContain('href="/services"');
  expect(html).toContain('href="/results"');
});
