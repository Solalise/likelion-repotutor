import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { securityFixtures } from "@/lib/ast/securityFixtures";
import { AnalysisSummary } from "./AnalysisSummary";
import { SqlInjectionFindings } from "./SqlInjectionFindings";

it("shows honest file coverage, four status cards and collapsed manual/diagnostic panels", () => {
  const a = analyzeSourceFiles(securityFixtures.sqliVulnerable);
  a.collection = { source: "github", repositoryFiles: 3, analyzableFiles: 2, excludedFiles: 1, discoveredFiles: 2, collectedFiles: 2, totalBytes: 100, durationMs: 1, partial: false,
    manifest: [{ path: "src/search.ts", bytes: 50, status: "included" }, { path: "src/app/api/search/route.ts", bytes: 50, status: "included" }, { path: "api.py", bytes: 20, status: "excluded", reason: "unsupported-language" }] };
  const html = renderToStaticMarkup(<SqlInjectionFindings analysis={a} />);
  for (const label of ["저장소 전체 파일", "실제 검사 파일", "분석 가능 파일", "제외 파일", "SQL Injection", "XSS", "IDOR", "권한 검증", "입력 연결 위험 지점", "api.py", "미지원 언어"]) expect(html).toContain(label);
  expect(html).toContain('aria-label="SQL Injection"');
  expect(html).toContain("실행 미검증");
  expect(html).toContain("확정 호출 경로의 API");
  expect(html).not.toMatch(/<details[^>]*open/);
});

it("renders an unsupported-only source separately from a failed pass", () => {
  const a = analyzeSourceFiles(securityFixtures.unsupportedLanguage);
  expect(renderToStaticMarkup(<AnalysisSummary analysis={a} />)).toContain("전체 상태: 미지원");
  const failed = analyzeSourceFiles(securityFixtures.sqliFixed);
  failed.sqlInjection!.coverage!.status = "failed";
  const html = renderToStaticMarkup(<SqlInjectionFindings analysis={failed} />);
  expect(html).toContain("분석 실패: 후보 유무를 판단하지 못했습니다.");
  expect(html).not.toContain("현재 지원하는 패턴과 수집 범위에서 후보를 찾지 못했습니다.");
});
