import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RunnerLab, { ResultPanel } from "./RunnerLab";
import { verdictLabels, type RunnerResult } from "@/lib/security-lab/runnerTypes";
import { LabSessionProvider } from "@/components/security/LabSession";

describe("local runner UI", () => {
  it("allows preparation without GitHub and disables execution until pairing and local approval", () => {
    const html = renderToStaticMarkup(<LabSessionProvider><RunnerLab apiPath="/orders/{resourceId}" resourceA="101" resourceB="102"><p>API 입력</p></RunnerLab></LabSessionProvider>);
    expect(html).toContain("GitHub 로그인 없이 사용할 수 있습니다");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>현재 조건으로 요청 계획 등록/);
    expect(html).not.toContain("승인된 계획 실제 실행");
    expect(html).not.toContain('name="tokenA"');
    expect(html).toContain("SQL Injection");
    expect(html).toContain("준비 중 · 실행 불가");
    expect(html.indexOf("내 웹서비스 연결")).toBeLessThan(html.indexOf("API 입력"));
    expect(html.indexOf("API 입력")).toBeLessThan(html.indexOf("사용자 승인 후 실제 요청 실행"));
  });
  for (const verdict of Object.keys(verdictLabels) as RunnerResult["verdict"][]) it(`renders actual ${verdict} evidence and bounded-scope explanation`, () => {
    const result: RunnerResult = { verdict, reason: "관찰한 근거", scope: "웹사이트 전체의 안전을 보장하지 않습니다.", requestCount: 5,
      evidence: [{ account: "A", purpose: "A → B", path: "/orders/102", status: verdict === "blocked" ? 403 : 200, response: { resourceId: "102", ownerId: "B", protectedFingerprint: "aabb" } }] };
    const html = renderToStaticMarkup(<ResultPanel result={result} />);
    expect(html).toContain(verdictLabels[verdict]);
    expect(html).toContain("GET /orders/102");
    expect(html).toContain("aabb");
    expect(html).toContain("웹사이트 전체의 안전을 보장하지 않습니다");
    expect(html).toContain("수정 후 재검증");
  });
});
