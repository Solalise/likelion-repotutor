import { expect, it } from "vitest";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "@/lib/features/featureDiscovery";
import { buildLearningStages, buildRepositoryLearningGraph, selectLearningStageGraph, traverseLearningGraph } from "@/lib/learning/learningGraphBuilder";
import type { RepositoryAnalysis } from "@/types/analysis";
import { GET } from "./route";

const integrationTest = process.env.RUN_GITHUB_INTEGRATION === "1" ? it : it.skip;

integrationTest("collects and analyzes a real public GitHub repository through the API route", async () => {
  const url = new URL("http://localhost/api/analyze");
  url.searchParams.set("source", "github");
  url.searchParams.set("url", "https://github.com/team-mallang/likelion-hackathon");

  const response = await GET(new Request(url));
  const payload = await response.json();
  expect(response.status).toBe(200);
  expect(payload).toMatchObject({
    repository: "team-mallang/likelion-hackathon",
    source: "github",
    collection: { source: "github", defaultBranch: expect.any(String) },
  });
  expect(payload.stats.files).toBeGreaterThan(0);
  expect(payload.nodes.length).toBeGreaterThan(0);

  const features = discoverRepositoryFeatures(payload as RepositoryAnalysis);
  const defaultNames = [...features.primary, ...features.limited].map((feature) => feature.technicalName);
  expect(defaultNames).not.toContain("Button");
  expect(defaultNames).not.toContain("createGradleBlock");
  expect(features.hidden.map((feature) => feature.technicalName)).toEqual(expect.arrayContaining([
    "Button", "createGradleBlock", "replaceAgoraGradleBlock",
  ]));

  const documentScan = features.primary.find((feature) => feature.title === "문서 스캔");
  expect(documentScan).toMatchObject({ limited: false });
  expect(["DocumentScanRoute", "DocumentScanScreen"]).toContain(documentScan?.technicalName);
  expect(documentScan?.filePaths).toEqual(expect.arrayContaining([
    "apps/mobile/app/case/document-scan/index.tsx",
    "apps/mobile/src/features/document-scan/screens/DocumentScanScreen.tsx",
  ]));
  const graph = traverseRepositoryFeature(payload as RepositoryAnalysis, documentScan!, 3);
  expect(graph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["DocumentScanRoute", "DocumentScanScreen"]));
  expect(graph.edges.length).toBeGreaterThan(0);

  const documentLearning = buildRepositoryLearningGraph(payload as RepositoryAnalysis, documentScan!.nodeIds);
  expect(documentLearning.nodes.find((node) => node.technicalName === "DocumentScanScreen")).toMatchObject({
    title: "문서 스캔 화면",
    confidence: "confirmed",
    source: "ast",
  });
  const documentScreenNode = documentLearning.nodes.find((node) => node.technicalName === "DocumentScanScreen")!;
  expect(documentScreenNode.codeSnippet).toContain("function DocumentScanScreen");
  expect(documentScreenNode.line).toBeGreaterThan(0);
  expect(documentLearning.nodes.some((node) => node.source === "demo")).toBe(false);
  expect(documentLearning.edges.every((edge) => ["call", "component", "reference", "import", "request"].includes(edge.relation))).toBe(true);
  expect(traverseLearningGraph(documentLearning, documentScan!.entryNodeId, 3, 7).nodes.length).toBeLessThanOrEqual(7);
  const documentStages = buildLearningStages(documentLearning, documentScan!.entryNodeId);
  expect(documentStages.map((stage) => stage.title)).toEqual(expect.arrayContaining(["기능 개요", "화면 구성", "사용자 동작"]));
  expect(documentStages.every((stage) => stage.nodeIds.length > 0)).toBe(true);
  expect(selectLearningStageGraph(documentLearning, documentStages[0]).nodes.length).toBeLessThanOrEqual(4);

  const policeReport = [...features.primary, ...features.limited].find((feature) => feature.technicalName === "PoliceReportScreen");
  expect(policeReport).toBeDefined();
  const policeLearning = buildRepositoryLearningGraph(payload as RepositoryAnalysis, policeReport!.nodeIds);
  expect(policeLearning.nodes.find((node) => node.technicalName === "PoliceReportScreen")?.title).toBe("사건 신고 화면");
  const policeHandlers = policeLearning.nodes.filter((node) => /^(?:handle|on)[A-Z]/.test(node.technicalName ?? ""));
  expect(policeHandlers.length).toBeGreaterThan(1);
  expect(new Set(policeHandlers.map((node) => node.title)).size).toBe(policeHandlers.length);
});
