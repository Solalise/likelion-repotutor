import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewFeatureAnalysis } from "@/lib/security-lab/reviewGuideFixtures";
import { buildReviewGuides, type ProjectGuide } from "@/lib/security-lab/reviewGuide";
import { presentGuideBundle } from "./guideDisplaySteps";
import type { RepositoryAnalysis } from "@/types/analysis";
const mock = vi.hoisted(() => ({ request: vi.fn(), model: vi.fn(() => "test-model") }));
vi.mock("./groq", async original => ({ ...await original<typeof import("./groq")>(), requestGroqCompletion: mock.request, groqModel: mock.model }));
import { clearSecurityGuideCacheForTests, generateSecurityGuides, explanationContext, explanationResponseFormat, validateGuideExplanations, privateCodeExcerpt } from "./securityReviewGuide";
let analysis: RepositoryAnalysis, base: ProjectGuide[];
beforeAll(() => { analysis = reviewFeatureAnalysis(); base = buildReviewGuides(analysis); });
beforeEach(() => { mock.request.mockReset(); mock.model.mockReturnValue("test-model"); clearSecurityGuideCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });
const reply = () => ({ projectExplanation: "관찰된 입력과 데이터 처리의 연결을 코드에서 확인해 보세요.", codeExplanations: Object.fromEntries(explanationContext(base).map(source => [source.key, "이 구문이 값을 수집하거나 처리하는 위치를 확인해 보세요."])) });
const response = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
it("extracts at most six private code excerpts with server-only reference bindings", () => {
  const context = explanationContext(base);
  expect(context.length).toBeGreaterThan(0); expect(context.length).toBeLessThanOrEqual(6);
  expect(context.some(c => c.kind === "XSS" && c.role === "input")).toBe(true);
  expect(context.some(c => c.kind === "XSS" && c.role === "output")).toBe(true);
  for (const item of context) expect(base.find(g => g.kind === item.kind)!.sources.some(s => s.id === item.sourceId)).toBe(true);
  const code = privateCodeExcerpt('const privateCustomer = "Alice Personal"; // internal note\nquery(`private ${privateCustomer}`, 123456789);');
  for (const secret of ["Alice", "Personal", "internal note", "privateCustomer", "123456789"]) expect(code).not.toContain(secret);
});
it("uses only two response fields with fixed server-generated code keys, not guides or steps", () => {
  mock.model.mockReturnValue("openai/gpt-oss-20b");
  const format = JSON.parse(JSON.stringify(explanationResponseFormat(explanationContext(base))));
  expect(format.json_schema.strict).toBe(true);
  expect(format.json_schema.schema.required).toEqual(["projectExplanation", "codeExplanations"]);
  expect(format.json_schema.schema.additionalProperties).toBe(false);
  expect(format.json_schema.schema.properties.codeExplanations.required).toEqual(explanationContext(base).map(c => c.key));
  for (const field of ["steps", "sourceIds", "featureId", "location", "action"]) expect(JSON.stringify(format)).not.toContain(`"${field}"`);
});
it("rejects extra structure, unknown or missing references, credentials, invented locations and unconfirmed security claims", () => {
  const context = explanationContext(base), value = reply();
  expect(validateGuideExplanations(value, context)).toEqual(value);
  expect(() => validateGuideExplanations({ ...value, steps: [] }, context)).toThrow();
  expect(() => validateGuideExplanations({ ...value, codeExplanations: { ...value.codeExplanations, fake: "추가 코드" } }, context)).toThrow();
  expect(() => validateGuideExplanations({ ...value, codeExplanations: {} }, context)).toThrow();
  for (const text of ["Authorization: Bearer synthetic-secret", "https://unknown.example", "app/fake/page.tsx:99", "<script>alert(1)</script>", "확인되지 않은 코드는 안전합니다.", "결제 페이지를 확인하세요."]) expect(() => validateGuideExplanations({ ...value, projectExplanation: text }, context)).toThrow();
  const xss = context.filter(source => source.kind === "XSS");
  expect(() => validateGuideExplanations({ projectExplanation: "관리자 역할의 존재를 확인해 보세요.", codeExplanations: Object.fromEntries(xss.map(source => [source.key, "관련 문자를 처리하는 코드를 읽어 보세요."])) }, xss)).toThrow("UNOBSERVED_ROLE");
});
it("enriches explanations only and preserves server actions, steps, locations, expected behavior and expansion", async () => {
  mock.request.mockResolvedValue(response(reply()));
  const bundle = await generateSecurityGuides(analysis, "explanations:ownership");
  const original = presentGuideBundle({ guides: base, origin: "fallback" });
  expect(bundle.origin).toBe("ai"); expect(mock.request).toHaveBeenCalledTimes(1);
  for (let i = 0; i < base.length; i++) {
    expect(bundle.guides[i].steps.map(({ id, action, sourceIds, featureId, expected, preparation, observe }) => ({ id, action, sourceIds, featureId, expected, preparation, observe })))
      .toEqual(original.guides[i].steps.map(({ id, action, sourceIds, featureId, expected, preparation, observe }) => ({ id, action, sourceIds, featureId, expected, preparation, observe })));
    expect(bundle.guides[i].sources.map(({ id, location, code }) => ({ id, location, code }))).toEqual(base[i].sources.map(({ id, location, code }) => ({ id, location, code })));
  }
  expect(bundle.guides[1].steps).toHaveLength(5);
  expect(bundle.guides[1].sources.some(s => s.reason.includes("AI 코드 설명"))).toBe(true);
  const prompt = mock.request.mock.calls[0][0] as string;
  expect(prompt).not.toContain(analysis.repository); expect(prompt).not.toContain("actions/contacts.ts");
});
it("coalesces and caches a single explanation request, without calls for display expansion", async () => {
  mock.request.mockResolvedValue(response(reply()));
  const [first, second] = await Promise.all([generateSecurityGuides(analysis, "explanations:cache"), generateSecurityGuides(analysis, "explanations:cache")]);
  expect(first.origin).toBe("ai"); expect(second.origin).toBe("ai"); expect(mock.request).toHaveBeenCalledTimes(1);
  expect((await generateSecurityGuides(analysis, "explanations:cache")).cached).toBe(true); expect(mock.request).toHaveBeenCalledTimes(1);
});
it("preserves the baseline on failure, caches that failure, and skips AI for absent evidence", async () => {
  mock.request.mockRejectedValueOnce(new Error("private provider message"));
  const result = await generateSecurityGuides(analysis, "explanations:failure");
  expect(result.origin).toBe("fallback"); expect(result.reason).not.toContain("private provider message");
  expect(result.guides).toEqual(presentGuideBundle({ guides: base, origin: "fallback" }).guides);
  await generateSecurityGuides(analysis, "explanations:failure"); expect(mock.request).toHaveBeenCalledTimes(1);
  const empty = { ...analysis, files: [], nodes: [], edges: [], entryPoints: [], sqlInjection: undefined, xss: undefined, accessControl: undefined };
  expect((await generateSecurityGuides(empty, "explanations:no-evidence")).origin).toBe("fallback"); expect(mock.request).toHaveBeenCalledTimes(1);
});
it.runIf(process.env.RUN_ACTUAL_REPO_AI === "1")("verifies one real Groq explanation request with synthetic code and no fallback success", async () => {
  dotenv.config({ path: ".env.local", quiet: true }); dotenv.config({ path: ".env", quiet: true });
  const actual = await vi.importActual<typeof import("./groq")>("./groq");
  mock.model.mockImplementation(actual.groqModel); mock.request.mockImplementation(actual.requestGroqCompletion);
  let calls = 0;
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (++calls > 1) throw new Error("LIVE_CALL_LIMIT");
    const res = await original(url, init); const data = await res.clone().json().catch(() => ({}));
    if (res.ok && typeof data.choices?.[0]?.message?.content === "string") writeFileSync(join(tmpdir(), "vulnlab-groq-explanations-response.json"), data.choices[0].message.content, "utf8");
    const cause = /max completion tokens reached/i.test(data.error?.message ?? "") ? "OUTPUT_TRUNCATED" : /tokens per minute|request too large/i.test(data.error?.message ?? "") ? "REQUEST_TOKEN_LIMIT" : data.error?.code === "json_validate_failed" ? "JSON_VALIDATION_FAILED" : res.ok ? "HTTP_SUCCESS" : "PROVIDER_ERROR";
    console.info("safe live result", { status: res.status, cause, model: actual.groqModel(), finishReason: data.choices?.[0]?.finish_reason });
    return res;
  });
  const result = await generateSecurityGuides(analysis, "explanations:live");
  console.info("validated guide origin", result.origin, result.origin === "fallback" ? result.reason : "explanations validated; server steps preserved");
  expect(calls).toBe(1); expect(result.origin, result.reason).toBe("ai");
  await generateSecurityGuides(analysis, "explanations:live"); expect(calls).toBe(1);
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/security-review-guide-live-examples.json", JSON.stringify({ source: "synthetic fixtures only; one real Groq call for explanations; all actions remain server-owned", ...result }, null, 2), "utf8");
}, 65000);
