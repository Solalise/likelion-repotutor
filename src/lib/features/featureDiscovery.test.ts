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

  it("returns only real analyzed edges while traversing in both directions", () => {
    const feature = discoverRepositoryFeatures(analysis).primary[0];
    const graph = traverseRepositoryFeature(analysis, feature, 2);
    expect(graph.nodes.map((item) => item.id)).toEqual([documentRoute.id, documentScreen.id, button.id]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["route-screen", "screen-button"]);
  });
});
