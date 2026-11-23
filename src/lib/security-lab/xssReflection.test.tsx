import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { safeXssProbe } from "./xssProbe";
import { analyzeXssReflection, xssObservationNote } from "./xssReflection";
import { XssResponseComparison } from "@/components/repository/XssRequestEditor";
import type { XssComparisonResult, XssRequestDraft } from "./xssTypes";
export const xssDraft: XssRequestDraft = { version: "xss-practice-v1", connectionId: "connection", repository: "org/repo", commitSha: "a".repeat(40), findingId: "xss:route:1",
  target: { deploymentOrigin: "https://fixture.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q", reflectionLocation: "result text", reflectionContext: "HTML_TEXT" }, baseline: { value: safeXssProbe.baseline }, test: { value: safeXssProbe.value } };
const htmlEncode = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function result(body: string): XssComparisonResult {
  const evidence = { requestId: "baseline", observedAt: "2026-11-19T00:00:00Z", outcome: "RESPONSE" as const, statusCode: 200, durationMs: 1, body: "<p>normal</p>", bodyTruncated: false, errorMessage: null, contentType: "text/html; charset=utf-8" };
  return { runId: "run", request: xssDraft, baseline: evidence, test: { ...evidence, requestId: "test", body }, assessment: { status: "INCONCLUSIVE", reason: "HTTP only", evidenceReferences: [] } };
}
describe("inert XSS marker observation", () => {
  it("distinguishes static-only, non-reflection, raw reflection and encoded reflection", () => {
    expect(analyzeXssReflection(null).status).toBe("STATIC_ONLY"); expect(analyzeXssReflection(null, true).status).toBe("UNAVAILABLE");
    expect(analyzeXssReflection(result("<p>no marker</p>")).status).toBe("NOT_REFLECTED");
    expect(analyzeXssReflection(result(`<p>${safeXssProbe.value}</p>`)).status).toBe("UNENCODED");
    expect(analyzeXssReflection(result(`<p>${htmlEncode(safeXssProbe.value)}</p>`))).toMatchObject({ status: "ENCODED", scriptExecution: "NOT_VERIFIED", occurrences: [{ context: "HTML_TEXT", encoding: "ENCODED" }] });
  });
  it("recognizes named, numeric and hexadecimal entities without recursive decoding", () => {
    for (const encoded of [htmlEncode(safeXssProbe.value), safeXssProbe.value.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`), safeXssProbe.value.replace(/[<>&"']/g, c => `&#x${c.charCodeAt(0).toString(16)};`)]) expect(analyzeXssReflection(result(`<p>${encoded}</p>`)).status).toBe("ENCODED");
    expect(analyzeXssReflection(result(`<p>${htmlEncode(htmlEncode(safeXssProbe.value))}</p>`)).status).toBe("UNAVAILABLE");
    expect(analyzeXssReflection(result("<p>VULNLAB_XSS_V1_partial</p>")).status).toBe("UNAVAILABLE");
  });
  it("requires context-appropriate attribute escaping and flags unquoted or mismatched contexts", () => {
    const encoded = htmlEncode(safeXssProbe.value);
    const attribute = result(`<input value="${encoded}">`); attribute.request = { ...xssDraft, target: { ...xssDraft.target, reflectionContext: "HTML_ATTRIBUTE" } };
    expect(analyzeXssReflection(attribute)).toMatchObject({ status: "ENCODED", occurrences: [{ context: "HTML_ATTRIBUTE" }] });
    expect(analyzeXssReflection({ ...attribute, test: { ...attribute.test!, body: `<input value="${encoded.replace("&quot;", '"')}">` } }).status).toBe("UNENCODED");
    expect(analyzeXssReflection(result(`<input value="${encoded}">`)).status).toBe("UNAVAILABLE");
    const unquoted = { ...attribute, request: { ...attribute.request, target: { ...attribute.request.target, reflectionContext: "UNKNOWN" as const } }, test: { ...attribute.test!, body: `<input value=${encoded}>` } };
    expect(analyzeXssReflection(unquoted).status).toBe("UNENCODED");
  });
  it("does not call unsupported HTML, mixed occurrences or ambiguous baseline safe", () => {
    const encoded = htmlEncode(safeXssProbe.value);
    for (const body of [`<!--${encoded}-->`, `<script type="application/json">${encoded}</script>`, `<style>${encoded}</style>`, `<svg><text>${encoded}</text></svg>`, `<div "${encoded}">`, `<script type="application/json"></script-other><p>${encoded}</p>`]) expect(analyzeXssReflection(result(body)).status, body).toBe("UNAVAILABLE");
    expect(analyzeXssReflection(result(`<p>${encoded}</p><p>${safeXssProbe.value}</p>`)).status).toBe("UNENCODED");
    const contaminated = result(`<p>${encoded}</p>`); contaminated.baseline!.body = `VULNLAB_XSS_V1_`;
    expect(analyzeXssReflection(contaminated).status).toBe("UNAVAILABLE");
  });
  it("rejects incomplete, blocked, non-HTML and HTTP error observations", () => {
    const r = result(`<p>${htmlEncode(safeXssProbe.value)}</p>`);
    for (const patch of [{ outcome: "TIMEOUT" as const }, { outcome: "BLOCKED" as const }, { bodyTruncated: true }, { statusCode: 500 }, { contentType: "application/json" }, { contentType: null }, { contentType: "text/html; charset=shift-jis" }]) expect(analyzeXssReflection({ ...r, test: { ...r.test!, ...patch } }).status).toBe("UNAVAILABLE");
    expect(analyzeXssReflection({ ...r, baseline: null }).status).toBe("UNAVAILABLE");
  });
  it("renders all remote HTML as escaped text and records only a manual summary", () => {
    const r = result(`<p>${safeXssProbe.value}</p>`);
    const markup = renderToStaticMarkup(<XssResponseComparison result={r} />);
    expect(markup).toContain("실제 스크립트 실행 여부는 미검증"); expect(markup).toContain("서버 수집 HTTP 관찰");
    expect(markup).toContain("&lt;p&gt;"); expect(markup).not.toContain(`<p>${safeXssProbe.value}</p>`);
    expect(xssObservationNote(r)).toContain("서버 미검증 수동 메모"); expect(xssObservationNote(r)).toContain(xssDraft.commitSha);
  });
});
