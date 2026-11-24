import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProjectSecurityReview, ReviewGuide } from "./ProjectSecurityReview";
import { reviewKinds } from "@/lib/security-lab/projectReview";
import type { RepositoryAnalysis } from "@/types/analysis";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const analysis: RepositoryAnalysis = { repository: "org/app", source: "github", collection: { source: "github", commitSha: "a".repeat(40), discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, partial: false, durationMs: 0 }, files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 }, technology: { frameworks: ["Next.js"], databases: ["MongoDB"], persistence: ["Mongoose (ODM)"], evidence: [], notes: [] } };
it("shows all four guides, environment registration and 0/4 progress even with zero candidates", () => {
  const html = renderToStaticMarkup(<ProjectSecurityReview analysis={analysis} connectionId="own" />);
  for (const label of ["org/app", "a".repeat(40), "Next.js", "MongoDB", "SQL Injection", "XSS", "IDOR", "권한 검증", "0/4", "사이트 주소 등록 (선택)", "Vercel 계정 연결은 요구하지 않습니다", "사용자 수동 기록"]) expect(html).toContain(label);
  for (const ownershipSetup of ["검증 토큰 발급", "vulnlab-ownership.txt", "다시 배포", "소유권 관리"]) expect(html).not.toContain(ownershipSetup);
  expect(html).toContain("문제 발견"); expect(html).toContain("문제 미관찰"); expect(html).toContain("판정 불가"); expect(html).toContain("해당 없음");
  for (const obsolete of ['href="/practice"', 'href="/security-lab/project"', "Vercel 계정 관리", "Vercel 프로젝트 관리", "배포 커밋 확인"]) expect(html).not.toContain(obsolete);
});
it("explains unknown project evidence honestly in every guide without inventing routes or code", () => {
  for (const kind of reviewKinds) {
    const html = renderToStaticMarkup(<ReviewGuide analysis={analysis} kind={kind} />);
    for (const label of ["정적 후보를 확인하지 못했습니다", "정상적으로 기대되는 보안 동작", "방어 검증 절차", "결과 기록 방법", "관련 보안 처리 방식"]) expect(html).toContain(label);
    expect(html).not.toContain("/api/orders");
    expect(html).not.toContain("app/actions.ts");
  }
});
it("preserves exact static source evidence separately from editable manual results", () => {
  const data = { ...analysis, sqlInjection: { version: "sqli-static-v1" as const, findings: [{ id: "sqli:1", type: "SQL_INJECTION" as const, filePath: "src/search.ts", line: 9, endLine: 9, code: "db.query(sql)", sink: "db.query", severity: "LOW" as const, confidence: "LOW" as const, relationship: "suspected" as const, evidence: [{ filePath: "src/search.ts", line: 9, code: "db.query(sql)", description: "Synthetic static evidence" }], reason: "Review the source", remediation: "Use parameter binding", limitations: [], runtimeExploitation: "not-tested" as const }], truncated: false, limitations: [] } };
  const html = renderToStaticMarkup(<ReviewGuide analysis={data} kind="SQL_INJECTION" />);
  expect(html).toContain("src/search.ts:9"); expect(html).toContain("Synthetic static evidence");
  expect(html).toContain("시스템 정적 분석 근거");
  expect(html).toContain("Use parameter binding");
});
