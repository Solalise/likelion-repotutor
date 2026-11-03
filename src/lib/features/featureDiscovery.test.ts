import { describe, expect, it } from "vitest";
import type { CodeNode, RepositoryAnalysis } from "@/types/analysis";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "./featureDiscovery";

const node = (name: string, type: CodeNode["type"], filePath: string): CodeNode => ({
  id: `symbol:${filePath}#${name}`,
  name,
  type,
  filePath,
  line: 1,
});

const documentRoute = node("DocumentScanRoute", "component", "apps/mobile/app/case/document-scan/index.tsx");
const documentScreen = node("DocumentScanScreen", "component", "apps/mobile/src/features/document-scan/screens/DocumentScanScreen.tsx");
const button = node("Button", "component", "apps/mobile/src/components/common/button.tsx");
const lookup = node("PreviousCaseLookupRoute", "component", "apps/mobile/app/case/lookup/index.tsx");
const createGradle = node("createGradleBlock", "function", "apps/mobile/plugins/withAgoraRtmAndroid.js");
const replaceGradle = node("replaceAgoraGradleBlock", "function", "apps/mobile/plugins/withAgoraRtmAndroid.js");

const analysis: RepositoryAnalysis = {
  repository: "team-mallang/likelion-hackathon",
  source: "github",
  files: [],
  nodes: [documentRoute, documentScreen, button, lookup, createGradle, replaceGradle],
  edges: [
    { id: "route-screen", source: documentRoute.id, target: documentScreen.id, relation: "call" },
    { id: "screen-button", source: documentScreen.id, target: button.id, relation: "call" },
    { id: "gradle-replace", source: createGradle.id, target: replaceGradle.id, relation: "call" },
  ],
  stats: { files: 5, functions: 6, relations: 3 },
};

describe("discoverRepositoryFeatures", () => {
  it("prioritizes connected business features and keeps common/tooling nodes hidden", () => {
    const result = discoverRepositoryFeatures(analysis);
    expect(result.primary[0]).toMatchObject({
      title: "문서 스캔",
      technicalName: "DocumentScanRoute",
      connectionCount: 2,
      connectedNodeCount: 3,
    });
    expect(result.primary[0].nodeIds).toContain(button.id);
    expect(result.limited).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "이전 사건 조회", technicalName: "PreviousCaseLookupRoute", limited: true }),
    ]));
    expect([...result.primary, ...result.limited].map((feature) => feature.technicalName)).not.toContain("Button");
    expect(result.hidden.map((feature) => feature.technicalName)).toEqual(expect.arrayContaining([
      "Button", "createGradleBlock", "replaceAgoraGradleBlock",
    ]));
  });

  it("returns only real analyzed edges in call direction", () => {
    const feature = discoverRepositoryFeatures(analysis).primary[0];
    const graph = traverseRepositoryFeature(analysis, feature, 2);
    expect(graph.nodes.map((item) => item.id)).toEqual([documentRoute.id, documentScreen.id, button.id]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: documentRoute.id, target: documentScreen.id, relation: "call", occurrences: [expect.objectContaining({ edgeId: "route-screen" })] }),
      expect.objectContaining({ source: documentScreen.id, target: button.id, relation: "call", occurrences: [expect.objectContaining({ edgeId: "screen-button" })] }),
    ]);
  });

  it("keeps HTTP handlers, providers and mocks out of the top-level feature list", () => {
    const screen = node("CaseSearchScreen", "component", "apps/mobile/src/features/case-search/screens/CaseSearchScreen.tsx");
    const handler = node("handleSearch", "function", "apps/mobile/src/features/case-search/screens/CaseSearchScreen.tsx");
    const post = node("POST", "api", "apps/web/src/app/api/cases/search/route.ts");
    const provider = node("CaseProvider", "component", "apps/mobile/src/features/case/context/CaseContext.tsx");
    const mock = node("searchWithMock", "function", "packages/search/src/mock.ts");
    const result = discoverRepositoryFeatures({
      ...analysis,
      nodes: [screen, handler, post, provider, mock],
      edges: [
        { id: "screen-handler", source: screen.id, target: handler.id, relation: "reference" },
        { id: "handler-post", source: handler.id, target: post.id, relation: "api" },
        { id: "screen-provider", source: screen.id, target: provider.id, relation: "reference" },
      ],
    });
    expect([...result.primary, ...result.limited].map((feature) => feature.technicalName)).toEqual(["CaseSearchScreen"]);
    expect(result.primary[0].nodeIds).toEqual(expect.arrayContaining([screen.id, handler.id, post.id, provider.id]));
    expect(result.hidden.map((feature) => feature.technicalName)).toEqual(expect.arrayContaining(["CaseProvider", "searchWithMock"]));
  });

  it("supports an optional mapping using analyzed node IDs only", () => {
    const entry = node("CustomFlow", "function", "src/domain/custom.ts");
    const internal = node("runCustomFlow", "function", "src/domain/custom.ts");
    const result = discoverRepositoryFeatures({ ...analysis, nodes: [entry, internal], edges: [] }, {
      mappings: [{ entryNodeId: entry.id, title: "사용자 지정 흐름", includeNodeIds: [internal.id, "missing"] }],
    });
    expect(result.limited[0]).toMatchObject({ title: "사용자 지정 흐름", technicalName: "CustomFlow" });
    expect(result.limited[0].nodeIds).toEqual([entry.id, internal.id]);
  });
});
