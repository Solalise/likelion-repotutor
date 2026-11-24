import { expect, it } from "vitest";
import { expandValidatedGuide, presentGuideBundle } from "./guideDisplaySteps";
import { buildReviewGuides } from "@/lib/security-lab/reviewGuide";
import { reviewFeatureAnalysis, reviewFeatureSources } from "@/lib/security-lab/reviewGuideFixtures";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { extensionRecordDraft, extensionRecordProgress, extensionSession } from "@/lib/security-lab/extensionReview";
import { emptyProjectReview, reviewRecordKey } from "@/lib/security-lab/projectReview";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";

it("separates fixed slots from variable display steps and keeps every source within validated citations", () => {
  const base = buildReviewGuides(reviewFeatureAnalysis());
  const xss = base.find(g => g.kind === "XSS")!;
  const expanded = expandValidatedGuide(xss);
  expect(xss.steps).toHaveLength(2); expect(expanded.steps).toHaveLength(5);
  expect(expanded.steps.map(s => s.id)).toEqual(["text-prepare", "map-overview", "map-input", "map-output", "text-observe"]);
  expect(expanded.steps.slice(1).every(step => step.preparation === undefined)).toBe(true);
  const cited = new Set(xss.steps.flatMap(s => s.sourceIds));
  expect(expanded.steps.every(s => s.sourceIds.every(id => cited.has(id)))).toBe(true);
  expect(expanded.steps.find(s => s.id.endsWith("-output"))!.sourceIds.every(id => xss.sources.find(s => s.id === id)?.role === "output")).toBe(true);
  expect(expandValidatedGuide(base.find(g => g.kind === "SQL_INJECTION")!).steps).toHaveLength(1);
  expect(expandValidatedGuide(base.find(g => g.kind === "IDOR")!).steps).toHaveLength(4);
});
it("keeps baseline contents immutable and can present fallback or cached AI without any API dependency", () => {
  const guides = buildReviewGuides(reviewFeatureAnalysis());
  const fallback = { guides, origin: "fallback" as const };
  const presented = presentGuideBundle(fallback);
  expect(presented.origin).toBe("fallback"); expect(presented.guides[1].steps.length).toBeGreaterThan(2);
  expect(presented.guides[1].steps.find(step => step.id.endsWith("-overview"))!.action).toContain("/contacts");
  const cached = presentGuideBundle({ guides, origin: "ai", cached: true });
  expect(cached.cached).toBe(true); expect(cached.guides[1].steps.length).toBeGreaterThan(2);
  expect(guides[1].steps).toHaveLength(2);
});
it("guides screen movement only to observed static pages and preserves related code explanations", () => {
  const xss = buildReviewGuides(reviewFeatureAnalysis())[1];
  const shown = expandValidatedGuide(xss);
  const shownOverview = shown.steps.find(step => step.id.endsWith("-overview"))!;
  expect(shownOverview.action).toContain("/contacts"); expect(shownOverview.explanation).toContain("실제 접속 URL: 직접 확인 필요");
  expect(shownOverview.feature).toBe("문의 게시판");
  expect(shown.sources).toBe(xss.sources);
  for (const label of ["getContact 함수 · 페이지 연결 미확인", "/contacts/[id] 페이지 · ContactPage"]) {
    const unknown = { ...xss, features: xss.features.map((f, i) => i ? f : { ...f, label }) };
    const overview = expandValidatedGuide(unknown).steps.find(step => step.id.endsWith("-overview"))!;
    expect(overview.explanation).toContain(label.startsWith("/") ? "코드상 경로 패턴: /contacts/[id]" : "페이지 경로가 확인되지 않았습니다");
    if (label.startsWith("/")) expect(overview.explanation).toContain("실제 접속 URL: 미확인");
    expect(overview.action).not.toContain("/contacts");
  }
});
it("provides harmless XSS comparison, concrete setup and interpretation without claiming exploitation", () => {
  const xss = expandValidatedGuide(buildReviewGuides(reviewFeatureAnalysis())[1]);
  const last = xss.steps.at(-1)!;
  const preparation = xss.steps[0];
  expect(preparation.preparation).toContain("승인된 격리 환경"); expect(preparation.preparation).toContain("합성 입력 문구 2개");
  expect(last.preparation).toBeUndefined();
  expect(last.observe).toContain("정상 문구: VulnLab 메모"); expect(last.observe).toContain("<b>VulnLab 메모</b>");
  expect(last.interpretation?.unexpected).toContain("XSS를 확정하지 않습니다");
  expect(last.explanation).toContain("실행하지 않습니다");
  const original = buildReviewGuides(reviewFeatureAnalysis())[1];
  const noInput = { ...original, features: original.features.map(f => ({ ...f, roles: f.roles.filter(role => role !== "input" && role !== "form") })) };
  const limited = expandValidatedGuide(noInput);
  expect(limited.steps.at(-1)!.action).toContain("기존 출력 테스트 기록"); expect(limited.steps[0].preparation).not.toContain("<b>");
});
it("compares synthetic ownership and role outcomes against policy including rejection side effects", () => {
  const guides = buildReviewGuides(reviewFeatureAnalysis());
  const idorGuide = expandValidatedGuide(guides.find(g => g.kind === "IDOR")!), idor = idorGuide.steps.at(-1)!;
  expect(idorGuide.steps[0].preparation).toContain("합성 계정 A와 B"); expect(idor.observe).toContain("A → A"); expect(idor.observe).toContain("B → B"); expect(idor.observe).toContain("B → A의 비공개 자료");
  expect(idor.expected).toContain("공개 자료"); expect(idor.interpretation?.unknown).toContain("판정 불가");
  const authGuide = expandValidatedGuide(guides.find(g => g.kind === "AUTHORIZATION")!), authorization = authGuide.steps.at(-1)!;
  expect(authGuide.steps[0].preparation).toContain("허용 역할과 비허용 역할"); expect(authorization.observe).toContain("실제 데이터도 바뀌지 않았는지");
  expect(authorization.explanation).toContain("기존 테스트"); expect(authorization.explanation).toContain("버튼이 숨겨진 것만");
  const source = guides.find(g => g.kind === "AUTHORIZATION")!;
  const noRoles = { ...source, features: source.features.map(f => ({ ...f, roles: f.roles.filter(role => role !== "role") })) };
  expect(expandValidatedGuide(noRoles).steps[0].preparation).toContain("관리자 전용 기능이나 관리자 계정이 있다고 가정하지 마세요");
});
it("prefers object-specific ownership filtering over public lists and declines unsupported target selection", () => {
  const ownedSources = reviewFeatureSources.map(file => file.path === "actions/contacts.ts" ? { ...file, content: file.content.replace("return Contact.findById(id);", "const session = await auth();\n  return Contact.findOne({ _id: id, ownerId: session.user.id });") } : file);
  const idor = buildReviewGuides(analyzeSourceFiles(ownedSources, "synthetic/owned")).find(g => g.kind === "IDOR")!;
  expect(idor.features[0].label).toContain("/contacts/[id]");
  const cited = new Set(idor.features[0].sourceIds);
  expect(idor.sources.filter(s => cited.has(s.id) && s.role === "database").every(s => s.code.includes("findOne"))).toBe(true);
  const publicOnly = reviewFeatureSources.map(file => file.path === "actions/contacts.ts" ? { ...file, content: file.content.split("export async function deleteContact")[0] } : file);
  const unknown = buildReviewGuides(analyzeSourceFiles(publicOnly, "synthetic/public-only")).find(g => g.kind === "IDOR")!;
  expect(unknown.features).toHaveLength(0); expect(unknown.applicability).toBe("inconclusive"); expect(unknown.steps[0].explanation).toContain("객체 식별자");
});
it("restores persisted manual counts only for the same commit and environment while keeping prior versions separate", () => {
  const analysis = reviewFeatureAnalysis();
  const environment: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 7, repository: { fullName: analysis.repository, htmlUrl: "https://github.com/synthetic/review-guide" }, deployment: { vercelUrl: "https://test.example.org", ownershipStatus: "UNVERIFIED", verifiedAt: null, testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
  const draft = extensionRecordDraft({ ...emptyProjectReview(), completed: true, outcome: "NOT_OBSERVED", expected: "Safe text", observed: "Manual text observation", evidence: "synthetic test" }, environment);
  const row = { id: "saved", revision: 1, updatedAt: "2026-11-24T00:00:00Z", repositoryFullName: analysis.repository, commitSha: analysis.collection!.commitSha, kind: "XSS" as const, recordKey: reviewRecordKey("own", 7, "XSS"), draft };
  const current = extensionRecordProgress([row, row], analysis, environment);
  expect(extensionSession(analysis, environment).guideBundle.guides[1].steps[0].id).toMatch(/-prepare$/);
  expect(current.current).toEqual(["XSS"]); expect(current.previous).toHaveLength(0);
  const newAnalysis = { ...analysis, collection: { ...analysis.collection!, commitSha: "b".repeat(40) } };
  const changed = extensionRecordProgress([row], newAnalysis, environment);
  expect(changed.current).toHaveLength(0); expect(changed.previous[0]).toMatchObject({ commit: analysis.collection!.commitSha, count: 1 });
  expect(extensionRecordProgress([row], analysis, { ...environment, deploymentVersion: 8 }).current).toHaveLength(0);
  expect(extensionRecordProgress([{ ...row, recordKey: reviewRecordKey("another-connection", 7, "XSS") }], analysis, environment).previous).toHaveLength(0);
});
