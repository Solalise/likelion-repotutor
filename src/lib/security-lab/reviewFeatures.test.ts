import { beforeAll, expect, it } from "vitest";
import { buildReviewGuides } from "./reviewGuide";
import { collectReviewFeatures } from "./reviewFeatures";
import { reviewFeatureAnalysis, reviewFeatureSources } from "./reviewGuideFixtures";
import type { RepositoryAnalysis } from "@/types/analysis";
let analysis: RepositoryAnalysis;
beforeAll(() => { analysis = reviewFeatureAnalysis(); });
it("ranks a connected input/action/database/output feature above a static about page", () => {
  const guide = buildReviewGuides(analysis).find(g => g.kind === "XSS")!;
  expect(guide.features[0].label).toContain("/contacts"); expect(guide.features[0].label).not.toContain("/about");
  for (const role of ["input", "form", "server-action", "database", "output"]) expect(guide.features[0].roles).toContain(role);
  expect(guide.sources.some(s => s.code.includes('formData.get("message")'))).toBe(true);
  expect(guide.sources.some(s => s.code.includes("contact.message"))).toBe(true);
  expect(guide.sources.every(s => !s.location.startsWith("app/about/"))).toBe(true);
});
it("anchors access review to actual operations and role checks instead of file boundary line one", () => {
  const guides = buildReviewGuides(analysis);
  const idor = guides.find(g => g.kind === "IDOR")!, roles = guides.find(g => g.kind === "AUTHORIZATION")!;
  expect(idor.sources.some(s => /Contact\.(find|findById)/.test(s.code))).toBe(true);
  expect(roles.sources.some(s => s.code.includes('session.user.role !== "admin"'))).toBe(true);
  expect([...idor.sources, ...roles.sources].every(s => s.location !== "actions/contacts.ts:1")).toBe(true);
  expect(roles.steps[0].preparation).toContain("합성");
});
it("reports exact source lines and never treats a static reference as proven runtime data flow", () => {
  for (const guide of buildReviewGuides(analysis)) for (const source of guide.sources) {
    const separator = source.location.lastIndexOf(":"), path = source.location.slice(0, separator), line = Number(source.location.slice(separator + 1));
    const file = reviewFeatureSources.find(file => file.path === path)!;
    expect(file).toBeDefined(); expect(file.content.split("\n")[line - 1].trim()).toBe(source.code);
  }
  expect(collectReviewFeatures(analysis).some(f => f.relations.some(r => r.status === "confirmed" && /미확인/.test(r.description)))).toBe(true);
});
it("does not expand a feature through an unresolved relationship", () => {
  const copy = { ...analysis, edges: analysis.edges.map(e => ({ ...e, confidence: "inferred" as const })), files: analysis.files.map(file => ({ ...file, imports: [] })) };
  const feature = collectReviewFeatures(copy).find(f => f.label.includes("/contacts 페이지"))!;
  expect(feature.facts.some(f => f.location.startsWith("actions/"))).toBe(false);
  expect(feature.relations.some(r => r.status === "unresolved")).toBe(true);
});
