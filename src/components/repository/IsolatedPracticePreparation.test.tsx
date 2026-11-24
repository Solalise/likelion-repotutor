import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IsolatedPracticePreparation } from "./IsolatedPracticePreparation";
import { SqlInjectionFindings } from "./SqlInjectionFindings";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";

it("offers preparation navigation without any deployment/account requirement or network request", () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const html = renderToStaticMarkup(<IsolatedPracticePreparation id="prep" repository="org/app" commitSha={"a".repeat(40)} codeLocation="app/actions.ts:3" />);
    for (const value of ['href="/practice"', 'href="/security-lab/project"', "org/app", "app/actions.ts:3", "실제 실행 승인이 아닙니다"]) expect(html).toContain(value);
    for (const value of ["Vercel", "Access Token", "소유권 확인", "배포 커밋 비교", 'type="url"']) expect(html).not.toContain(value);
    expect(html).toContain("외부 배포 사이트 실행은 비활성");
    expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});

it("keeps findings/code/manual records and replaces the deployment-bound preparation UI", () => {
  const analysis = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "import {Pool} from 'pg'; const db=new Pool(); export function GET(req) { return db.query('SELECT '+req.url); }" }], "org/app");
  const html = renderToStaticMarkup(<SqlInjectionFindings analysis={analysis} connectionId="own" />);
  expect(html).toContain("취약점 후보");
  expect(html).toContain("app/api/search/route.ts");
  expect(html).toContain("검사 결과 수동 기록");
  expect(html).not.toContain('href="/practice"');
  expect(html).not.toContain('href="/security-lab/project"');
  for (const value of ["Vercel", "배포 연결 상태", "배포 커밋 확인", "실습 대상 API 및 입력값 확인", 'href="/api/repositories/own/deployment"']) expect(html).not.toContain(value);
});
