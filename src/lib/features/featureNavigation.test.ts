import { describe, expect, it } from "vitest";
import type { RepositoryFeature } from "@/types/analysis";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { buildLearningContext } from "@/lib/ai/learningContext";
import { buildRepositoryLearningGraph } from "@/lib/learning/learningGraphBuilder";
import { discoverRepositoryFeatures, repositoryFeatureEdges, traverseRepositoryFeature } from "./featureDiscovery";
import { buildFeatureNavigation, featureNavigationLabel, searchFeatureNavigation } from "./featureNavigation";
import actualCaseSources from "./fixtures/caseNavigation.json";

function feature(path: string, options: Partial<RepositoryFeature> = {}): RepositoryFeature {
  const api = Boolean(options.httpMethod);
  return { id: `${options.httpMethod ?? "page"}:${path}`, title: api ? `${options.httpMethod} ${path} API` : `${path} 페이지`,
    technicalName: "Page", description: "긴 분석 설명. 실행 시점을 보장하지 않습니다.",
    entryNodeId: `${options.httpMethod ?? "page"}:${path}`, entryFilePath: `app${path}/${api ? "route.ts" : "page.tsx"}`,
    nodeIds: [path], edgeIds: [], filePaths: [], connectedNodeCount: 1, connectionCount: 0,
    limited: false, hidden: false, score: 100, entryKind: api ? "api" : "page", routePath: path, ...options };
}

describe("presentation-only feature navigation", () => {
  it("labels directory navigation as structural pages and preserves the child feature objects", () => {
    const children = [feature("/case/documents"), feature("/case/directions"), feature("/case/confirmation")];
    const groups = buildFeatureNavigation(children);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "case · 폴더별 페이지", titleInferred: false, directory: "app/case" });
    expect(groups[0].title).not.toContain("사건 처리");
    groups[0].features.forEach((child, index) => expect(child).toBe(children[index]));
  });

  it("does not group similar names, common URL prefixes or shared functions across directories", () => {
    const children = [feature("/case/documents"), feature("/cases/documents"), feature("/settings/documents")];
    children.forEach((child) => { child.title = "문서 화면"; child.nodeIds.push("shared"); });
    const groups = buildFeatureNavigation(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("ungrouped");
    expect(groups[0].features).toHaveLength(3);
  });

  it("separates the same route namespace across apps and route-group folders", () => {
    const children = ["apps/mobile/app", "apps/web/app", "apps/web/src/app", "app/(internal)", "app/(public)"].flatMap((root) => ["documents", "directions"].map((leaf) => feature(`/case/${leaf}`, {
      id: `${root}/${leaf}`, entryFilePath: `${root}/case/${leaf}/index.tsx`,
    })));
    const groups = buildFeatureNavigation(children);
    expect(groups).toHaveLength(5);
    expect(new Set(groups.map((group) => group.id)).size).toBe(5);
    expect(groups.every((group) => group.features.length === 2)).toBe(true);
  });

  it("does not use a generic route group to merge unrelated route namespaces", () => {
    const children = [feature("/case/documents", { entryFilePath: "app/(tabs)/case/documents/page.tsx" }),
      feature("/settings/profile", { entryFilePath: "app/(tabs)/settings/profile/page.tsx" })];
    expect(buildFeatureNavigation(children)[0].id).toBe("ungrouped");
  });

  it("keeps individual API methods, dynamic routes, pages and API resource directories distinct", () => {
    const children = [feature("/users"), feature("/users/[id]"),
      feature("/api/users", { httpMethod: "GET" }), feature("/api/users", { httpMethod: "POST" }),
      feature("/api/orders", { httpMethod: "GET" }), feature("/api/orders/[id]", { httpMethod: "DELETE" })];
    const groups = buildFeatureNavigation(children);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.features.length)).toEqual([2, 2, 2]);
    expect(groups.flatMap((group) => group.features).map((child) => child.id)).toEqual(children.map((child) => child.id));
    expect(groups[1].features.map((child) => featureNavigationLabel(child).path)).toEqual(["GET /api/users", "POST /api/users"]);
    expect(groups[0].features[1].routePath).toBe("/users/[id]");
  });

  it("keeps unknown roles path-based and does not turn methods into business actions", () => {
    expect(featureNavigationLabel(feature("/case/unknown-step"))).toMatchObject({ title: "unknown-step 페이지", path: "/case/unknown-step", titleInferred: false, summary: undefined });
    const label = featureNavigationLabel(feature("/api/users", { httpMethod: "POST" }));
    expect(label).toMatchObject({ title: "POST · 사용자 API", titleInferred: true, summary: "POST 요청 진입점" });
    expect(label.title).not.toContain("생성");
  });

  it("keeps explicit titles and manual entrypoints without manufacturing a route group", () => {
    const manual = feature("/case/documents", { id: "manual", entryKind: "manual", routePath: undefined, title: "담당자가 지정한 기능", entryFilePath: "src/service.ts" });
    expect(featureNavigationLabel(manual)).toMatchObject({ title: manual.title, path: "src/service.ts" });
    expect(buildFeatureNavigation([manual])[0].id).toBe("ungrouped");
    expect(featureNavigationLabel(feature("/case/documents", { title: "직접 지정한 화면", titleInferred: false })).title).toBe("직접 지정한 화면");
  });

  it("supports Korean group and child search plus technical names and normalized paths", () => {
    const groups = buildFeatureNavigation([feature("/case/documents"), feature("/case/directions")]);
    expect(searchFeatureNavigation(groups, " case ")[0].features).toHaveLength(2);
    expect(searchFeatureNavigation(groups, "폴더별 페이지")[0].features).toHaveLength(2);
    expect(searchFeatureNavigation(groups, "서류")[0].features[0].routePath).toBe("/case/documents");
    expect(searchFeatureNavigation(groups, "DIRECTIONS")[0].features[0].routePath).toBe("/case/directions");
    expect(searchFeatureNavigation(groups, "pAge")[0].features).toHaveLength(2);
    expect(searchFeatureNavigation(groups, "없는 이름")).toEqual([]);
  });

  it("deduplicates repeated feature IDs without changing their scopes", () => {
    const original = feature("/case/documents");
    Object.freeze(original.nodeIds); Object.freeze(original.edgeIds); Object.freeze(original);
    expect(buildFeatureNavigation([original, original])[0].features).toEqual([original]);
  });

  it("reproduces navigation from verified actual GitHub page sources without changing graph or AI context", () => {
    // Public files fetched from their sourceUrl; sha records the exact reviewed blob.
    const analysis = { ...analyzeSourceFiles(actualCaseSources, "team-mallang/likelion-hackathon"), source: "github" as const };
    const discovery = discoverRepositoryFeatures(analysis);
    const children = [...discovery.primary, ...discovery.limited];
    const before = JSON.stringify(discovery);
    const selected = children.find((child) => child.routePath === "/case/documents")!;
    const graph = traverseRepositoryFeature(analysis, selected, 5);
    const context = buildLearningContext(analysis, { type: "feature", feature: selected });
    const groups = buildFeatureNavigation(children);
    expect(groups).toHaveLength(1);
    expect(groups[0].directory).toBe("apps/mobile/app/case");
    expect(groups[0].title).toBe("case · 폴더별 페이지");
    expect(groups[0].features).toHaveLength(5);
    expect(new Set(groups[0].features.map(child => child.id))).toEqual(new Set(children.map(child => child.id)));
    expect(groups[0].features.map((child) => featureNavigationLabel(child).title).sort()).toEqual(["서류", "길 안내", "확인 화면", "주변 기관", "가이드"].sort());
    const searched = searchFeatureNavigation(groups, "서류")[0].features[0];
    expect(searched).toBe(selected);
    expect(traverseRepositoryFeature(analysis, searched, 5)).toEqual(graph);
    expect(buildLearningContext(analysis, { type: "feature", feature: searched })).toEqual(context);
    expect(buildRepositoryLearningGraph({ ...analysis, edges: repositoryFeatureEdges(analysis, searched) }, searched.nodeIds).nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    expect(JSON.stringify(discovery)).toBe(before);
    expect(context.code.map((code) => code.functionName)).toContain("DocumentsRoute");
    expect(context.code.map((code) => code.functionName)).not.toContain("DirectionsRoute");
  });

  it("separates untranslated page titles from full routes without changing identity or scope", () => {
    const original = feature("/case/card", { entryFilePath: "apps/mobile/app/case/card/index.tsx", nodeIds: ["entry", "callback"], edgeIds: ["reference:1"] });
    const before = JSON.stringify(original);
    const label = featureNavigationLabel(original);
    expect(label).toMatchObject({ title: "card 페이지", path: "/case/card", titleInferred: false });
    const groups = buildFeatureNavigation([original, feature("/case/directions", { entryFilePath: "apps/mobile/app/case/directions/index.tsx" })]);
    expect(searchFeatureNavigation(groups, "card")[0].features[0]).toBe(original);
    expect(searchFeatureNavigation(groups, original.entryFilePath)[0].features[0]).toBe(original);
    expect(JSON.stringify(original)).toBe(before);
  });
});
