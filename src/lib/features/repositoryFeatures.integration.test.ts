import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { SourceInput } from "@/types/analysis";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "./featureDiscovery";

const integrationTest = process.env.INTEGRATION_REPO_DIR ? it : it.skip;
const targetPaths = [
  "apps/mobile/app/case/document-scan/index.tsx",
  "apps/mobile/src/features/document-scan/screens/DocumentScanScreen.tsx",
  "apps/mobile/app/case/lookup/index.tsx",
  "apps/mobile/src/features/case-access/screens/PreviousCaseLookupScreen.tsx",
  "apps/mobile/app/case/nearby-agencies/index.tsx",
  "apps/mobile/src/features/nearby-agencies/screens/NearbyAgenciesScreen.tsx",
  "apps/mobile/src/components/common/button.tsx",
  "apps/mobile/plugins/withAgoraRtmAndroid.js",
];

integrationTest("discovers real feature graphs in team-mallang/likelion-hackathon", async () => {
  const repositoryDirectory = process.env.INTEGRATION_REPO_DIR!;
  const sources: SourceInput[] = await Promise.all(targetPaths.map(async (filePath) => ({
    path: filePath,
    content: await fs.readFile(path.join(repositoryDirectory, ...filePath.split("/")), "utf8"),
  })));
  const analysis = analyzeSourceFiles(sources, "team-mallang/likelion-hackathon");
  const features = discoverRepositoryFeatures(analysis);
  const defaults = [...features.primary, ...features.limited];

  expect(defaults.map((feature) => feature.technicalName)).not.toEqual(expect.arrayContaining([
    "Button", "createGradleBlock", "replaceAgoraGradleBlock",
  ]));
  expect(features.hidden.map((feature) => feature.technicalName)).toEqual(expect.arrayContaining([
    "Button", "createGradleBlock", "replaceAgoraGradleBlock",
  ]));
  expect(defaults.map((feature) => feature.routePath)).toEqual(expect.arrayContaining([
    "/case/document-scan", "/case/lookup", "/case/nearby-agencies",
  ]));

  const expectedNodes: Record<string, string[]> = {
    "/case/document-scan": ["DocumentScanRoute", "DocumentScanScreen"],
    "/case/lookup": ["PreviousCaseLookupRoute", "PreviousCaseLookupScreen"],
    "/case/nearby-agencies": ["NearbyAgenciesRoute", "NearbyAgenciesScreen"],
  };
  for (const [title, nodeNames] of Object.entries(expectedNodes)) {
    const feature = features.primary.find((item) => item.routePath === title);
    expect(feature, `${title} 기능이 실제 연결을 가져야 합니다.`).toBeDefined();
    const graph = traverseRepositoryFeature(analysis, feature!, 3);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: feature!.entryNodeId, filePath: feature!.entryFilePath }),
    ]));
    expect(graph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(nodeNames));
    expect(graph.edges.length).toBeGreaterThan(0);
  }
});
