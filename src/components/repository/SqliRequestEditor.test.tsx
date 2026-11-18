import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SqliRequestEditor, SqliResponseComparison } from "./SqliRequestEditor";
import { sqliAssessmentLabels, sqliDisplayAssessment, sqliRequestPreview, type SqliComparisonResult, type SqliRequestDraft } from "@/lib/security-lab/sqliTypes";

afterEach(() => vi.unstubAllGlobals());
const draft: SqliRequestDraft = {
  version: "sqli-practice-v1", connectionId: "connection-a", repository: "org/app", commitSha: "a".repeat(40), findingId: "sqli:route:1",
  target: { deploymentOrigin: "https://sandbox.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q" },
  baseline: { value: "normal & other=1" }, test: { value: "test input" },
};

it("renders both editable requests and empty response columns without dispatching HTTP or fabricating results", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const markup = renderToStaticMarkup(<SqliRequestEditor initialDraft={draft} onBack={() => {}} />);
  expect(markup).toContain("정상 요청 입력값"); expect(markup).toContain("테스트 요청 입력값");
  expect(markup).toContain("https://sandbox.vercel.app"); expect(markup).toContain("/api/search");
  expect(markup).toContain('aria-label="정상 응답"'); expect(markup).toContain('aria-label="테스트 응답"');
  expect(markup).toContain("결과 상태: <strong>미실행</strong>");
  expect(markup).toContain("측정되지 않음"); expect(markup).toContain("수신된 응답 본문이 없습니다.");
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>테스트 실행 환경 연결 전<\/button>/);
  expect(fetcher).not.toHaveBeenCalled();
  const preview = sqliRequestPreview(draft, "baseline");
  const url = new URL(preview.slice(4));
  expect([...url.searchParams]).toEqual([["q", draft.baseline.value]]);
  expect(sqliRequestPreview({ ...draft, test: { value: "changed" } }, "test")).toContain("q=changed");
});

it("keeps unverified evidence inconclusive and renders error, timing and escaped response evidence separately", () => {
  expect(Object.values(sqliAssessmentLabels)).toEqual(["미실행", "판정 불가", "취약점 확인", "취약 동작 미관찰"]);
  expect(sqliDisplayAssessment(null).status).toBe("NOT_RUN");
  const fixture: SqliComparisonResult = { runId: "test-fixture-only", request: draft,
    baseline: { requestId: "normal", observedAt: "2026-11-18T00:00:00Z", outcome: "RESPONSE", statusCode: 200, durationMs: 12,
      body: '<script>alert("fixture")</script>', bodyTruncated: true, errorMessage: null },
    test: { requestId: "test", observedAt: "2026-11-18T00:00:01Z", outcome: "TIMEOUT", statusCode: null, durationMs: 5000,
      body: null, bodyTruncated: false, errorMessage: "테스트 요청 시간 초과" },
    assessment: { status: "VULNERABILITY_CONFIRMED", reason: "untrusted fixture", evidenceReferences: [] },
  };
  expect(sqliDisplayAssessment({ ...fixture, baseline: null, test: null }).status).toBe("INCONCLUSIVE");
  const markup = renderToStaticMarkup(<SqliResponseComparison result={fixture} />);
  expect(markup).toContain("결과 상태: <strong>판정 불가</strong>");
  expect(markup).toContain("200"); expect(markup).toContain("12 ms"); expect(markup).toContain("5000 ms");
  expect(markup).toContain("테스트 요청 시간 초과"); expect(markup).toContain("본문 일부만 표시");
  expect(markup).toContain("&lt;script&gt;"); expect(markup).not.toContain("<script>");
});
