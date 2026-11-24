import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { reviewFeatureAnalysis } from "@/lib/security-lab/reviewGuideFixtures";
import { buildReviewGuides } from "@/lib/security-lab/reviewGuide";
import { generateSecurityGuides } from "./securityReviewGuide";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";

// Explicit manual opt-in only: the regular suite never calls the paid service.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
it.runIf(process.env.RUN_ACTUAL_REPO_AI === "1")("generates inspectable examples from synthetic contact code with one real Groq request", async () => {
  // One applicable type keeps the real-call smoke test bounded. The full contact
  // feature/role fixture is covered by mocked multi-type generation tests.
  const analysis = { ...analyzeSourceFiles([{ path: "app/contacts/page.tsx", content: `export default function ContactsPage({ searchParams }) {
    const message = searchParams.message;
    return <main><h1>문의 게시판</h1><form><textarea name="message"/><button>View</button></form><p>{searchParams.message}</p></main>;
  }` }], "synthetic/live-guide"), collection: { source: "github" as const, commitSha: "a".repeat(40), discoveredFiles: 1, collectedFiles: 1, totalBytes: 0, partial: false, durationMs: 0 } };
  const original = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const sent = JSON.parse(String(init?.body));
    const response = await original(url, init);
    const data = await response.clone().json().catch(() => ({}));
    const failed = data.error?.failed_generation;
    let valid: boolean | undefined;
    if (typeof failed === "string") { try { JSON.parse(failed); valid = true; } catch { valid = false; } }
    console.info("safe guide diagnostics", { status: response.status, model: sent.model, format: sent.response_format?.type, strict: sent.response_format?.json_schema?.strict,
      code: data.error?.code === "json_validate_failed" ? "json_validate_failed" : undefined, failedJsonValid: valid, generatedGuidesKeys: typeof failed === "string" ? (failed.match(/"guides"\s*:/g) ?? []).length : undefined, finishReason: data.choices?.[0]?.finish_reason });
    return response;
  });
  const bundle = await generateSecurityGuides(analysis, "manual-synthetic-examples").finally(() => spy.mockRestore());
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/security-review-guide-live-examples.json", JSON.stringify({ source: "synthetic fixtures only; may use validated fallback", ...bundle }, null, 2), "utf8");
  expect(bundle.origin, bundle.reason).toBe("ai");
  expect(bundle.guides.find(g => g.kind === "XSS")!.steps.length).toBeGreaterThan(2);
}, 65000);
it("produces feature-grounded baseline examples without any AI request", () => {
  const guides = buildReviewGuides(reviewFeatureAnalysis());
  if (process.env.WRITE_GUIDE_EXAMPLES === "1") {
    mkdirSync("docs", { recursive: true });
    writeFileSync("docs/security-review-guide-examples.json", JSON.stringify({ source: "local synthetic contact fixtures; deterministic feature-based fallback, NOT a successful live Groq response", origin: "fallback", guides }, null, 2), "utf8");
  }
  expect(guides).toHaveLength(4);
  expect(guides.find(g => g.kind === "XSS")!.steps[0].feature).toContain("/contacts");
});
