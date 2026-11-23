import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { practiceTarget, targetUrl } from "./practiceTarget";
import { PracticeTargetEditor } from "@/components/repository/PracticeTargetEditor";
import { requestServiceFindings } from "@/components/services/ServiceAnalysis";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("connects a real AST SQLi handler, preserves evidence and shows a non-executing preparation editor", () => {
  const analysis = analyzeSourceFiles([{ path: "src/app/api/search/route.ts", content: `
import { Pool } from 'pg';
const db = new Pool();
export async function GET(req: Request) {
 const q = new URL(req.url).searchParams.get('q');
 return Response.json(await db.query('SELECT * FROM items WHERE name = ' + q));
}` }], "org/app");
  const finding = analysis.sqlInjection!.findings[0];
  expect(finding).toBeDefined();
  expect(finding.evidence.length).toBeGreaterThan(0);
  expect(practiceTarget(analysis, finding)).toMatchObject({ path: "/api/search", method: "GET", status: "STATIC_HANDLER" });
  const markup = renderToStaticMarkup(<PracticeTargetEditor analysis={analysis} finding={finding} baseUrl="https://sandbox.vercel.app" ownership={true} />);
  expect(markup).toContain("/api/search");
  expect(markup).toContain("실행 승인 아님");
  expect(markup).toMatch(/disabled=""[^>]*>실습 준비 화면으로 이동/);
  expect(targetUrl("https://sandbox.vercel.app", "/api/search")).toBe("https://sandbox.vercel.app/api/search");
  for (const path of ["//other.com/api", "/api/[id]", "/%2e%2e/api", "/%5cother", "/api?x=1", "/api#x"]) expect(targetUrl("https://sandbox.vercel.app", path)).toBeNull();
  const unlinked = { ...analysis, entryPoints: [] };
  expect(practiceTarget(unlinked, finding)).toMatchObject({ path: "", method: "", status: "MANUAL_REQUIRED" });
  const ambiguous = { ...analysis, entryPoints: [...analysis.entryPoints!, { ...analysis.entryPoints![0], method: "POST" }] };
  expect(practiceTarget(ambiguous, finding).status).toBe("MANUAL_REQUIRED");
});

it("uses the existing authorized full-result API and handles zero candidates without inventing targets", async () => {
  const analysis = { ...analyzeSourceFiles([{ path: "src/app/api/health/route.ts", content: "export function GET() { return Response.json({ok: true}); }" }], "org/app"), source: "github", collection: { commitSha: "a".repeat(40) } };
  const fetcher = vi.fn().mockResolvedValue(Response.json(analysis));
  const result = await requestServiceFindings("connection/a", fetcher);
  expect(result.sqlInjection?.findings).toEqual([]);
  expect(result.xss?.findings).toEqual([]);
  expect(fetcher).toHaveBeenCalledWith("/api/repositories/connection%2Fa/analyze", expect.objectContaining({ credentials: "same-origin", redirect: "error", headers: { Accept: "application/json" } }));
  fetcher.mockResolvedValue(new Response(null, { status: 403 }));
  await expect(requestServiceFindings("denied", fetcher)).rejects.toThrow("GitHub 권한");
});

it("connects a real AST XSS candidate and requires reflection confirmation without sending requests", () => {
  const analysis = analyzeSourceFiles([{ path: "src/app/api/echo/route.ts", content: `
export function GET(req: Request) {
 const q = new URL(req.url).searchParams.get('q');
 return new Response('<p>' + q + '</p>', { headers: { 'Content-Type': 'text/html' } });
}` }], "org/app");
  const finding = analysis.xss!.findings.find(row => row.disposition === "candidate")!;
  expect(finding).toBeDefined(); expect(finding.id).toMatch(/^xss:/); expect(finding.evidence.length).toBeGreaterThan(0);
  expect(practiceTarget(analysis, finding)).toMatchObject({ path: "/api/echo", method: "GET", status: "STATIC_HANDLER" });
  const markup = renderToStaticMarkup(<PracticeTargetEditor analysis={analysis} finding={finding} baseUrl="https://sandbox.vercel.app" ownership={true} />);
  expect(markup).toContain("반영 위치"); expect(markup).toContain("예상 HTML 문맥"); expect(markup).toContain("실행 승인 아님");
  expect(markup).toMatch(/disabled=""[^>]*>실습 준비 화면으로 이동/);
});
