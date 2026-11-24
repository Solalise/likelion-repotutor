import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ cursor: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    const value = index === 0 ? { connectionId: "own", encryptionReady: true, connected: true,
      identity: { id: "saved-user", name: "Saved account", username: "saved" }, selection: { teamId: null, projectId: "prj_existing" }, analysisCommitSha: "a".repeat(40), deploymentUrl: "https://test.vercel.app" }
      : index === 7 ? "" : initial;
    return [value, vi.fn()];
  }, useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (fn: unknown) => fn,
}));
import { VercelAccountConnection } from "./VercelAccountConnection";
beforeEach(() => { state.cursor = 0; });
it("keeps the saved account/project summary and closes credential/project management by default", () => {
  const wrapper = VercelAccountConnection({ connectionId: "own", snapshot: { connectionId: "own", deploymentVersion: 1, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://test.vercel.app", ownershipStatus: "VERIFIED", verifiedAt: "2026-11-24T00:00:00Z", challengeExpiresAt: null, verificationAttemptsRemaining: 5, testRequestsAllowed: false } } });
  const view = (wrapper.type as (props: unknown) => ReactNode)((wrapper as ReactElement).props);
  const html = renderToStaticMarkup(view);
  expect(html).toContain("Saved account");
  expect(html).toContain("prj_existing");
  expect(html).toContain("다시 등록하지 않아도 됩니다");
  expect(html).toContain("Vercel 계정 관리 · 토큰 교체 / 연결 해제");
  expect(html).toContain("Vercel 프로젝트 관리 · 선택 / 변경");
  expect(html).not.toMatch(/<details[^>]*open/);
  expect(html).toContain("실제 요청 허용: 아니요");
});
