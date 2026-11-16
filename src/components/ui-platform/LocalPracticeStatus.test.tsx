import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PracticeDashboard } from "./PracticeDashboard";

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const pair = actual.useState(initial);
    return initial === "checking" ? ["unavailable", pair[1]] : pair;
  } };
});

it("shows failure, launch instructions and an enabled retry without blocking any practice link", () => {
  const html = renderToStaticMarkup(<PracticeDashboard/>);
  expect(html).toContain("서버 상태를 확인할 수 없습니다");
  expect(html).toContain("실습 서버 실행 방법 (PowerShell)");
  expect(html).toContain("상태 확인에 실패해도");
  expect(html).toMatch(/<button[^>]*>상태 다시 확인<\/button>/);
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>상태 다시 확인/);
  expect((html.match(/target="_blank"/g) ?? [])).toHaveLength(4);
});
