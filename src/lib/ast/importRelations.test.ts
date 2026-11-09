import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import { buildRepositoryLearningGraph, traverseLearningGraph } from "@/lib/learning/learningGraphBuilder";
import { buildRepositoryOverview } from "@/lib/graph/repositoryOverview";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "@/lib/features/featureDiscovery";
import { buildLearningContext } from "@/lib/ai/learningContext";

describe("file dependencies versus function flow", () => {
  it("retains unused and side-effect imports only as developer file dependencies", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: "import { unused } from '../lib/actions'; import '../lib/setup'; export default function Page() { return <div/>; }" },
      { path: "lib/actions.ts", content: "export function unused() { return true; }" },
      { path: "lib/setup.ts", content: "export function configure() { return false; }" },
    ]);
    expect(analysis.edges).toEqual([
      expect.objectContaining({ source: "file:app/page.tsx", target: "file:lib/actions.ts", relation: "import", confidence: "confirmed" }),
      expect.objectContaining({ source: "file:app/page.tsx", target: "file:lib/setup.ts", relation: "import", confidence: "confirmed" }),
    ]);
    const graph = buildRepositoryLearningGraph(analysis);
    expect(graph.edges).toEqual([]);
    const page = analysis.nodes.find((node) => node.name === "Page")!;
    expect(traverseLearningGraph(graph, page.id, 5).nodes.map((node) => node.id)).toEqual([page.id]);
    const feature = discoverRepositoryFeatures(analysis).limited.find((item) => item.entryNodeId === page.id)!;
    expect(feature.nodeIds).toEqual([page.id]);
    expect(traverseRepositoryFeature(analysis, feature, 5).edges).toEqual([]);
    expect(buildRepositoryOverview(analysis).edges.filter((edge) => edge.relation === "import")).toHaveLength(1);
    expect(buildLearningContext(analysis, { type: "function", functionId: page.id }).candidateCodeCount).toBe(1);
  });

  it("connects only the called imported symbol, never an unrelated representative function", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: "import { selected, unused } from '../lib/actions'; export default function Page() { selected(); return <div/>; }" },
      { path: "lib/actions.ts", content: "export function unrelatedFirst() {} export function selected() { return 42; } export function unused() {}" },
    ]);
    const page = analysis.nodes.find((node) => node.name === "Page")!;
    const selected = analysis.nodes.find((node) => node.name === "selected")!;
    expect(analysis.edges.filter((edge) => edge.relation === "call")).toEqual([
      expect.objectContaining({ source: page.id, target: selected.id, confidence: "confirmed" }),
    ]);
    const graph = buildRepositoryLearningGraph(analysis);
    expect(graph.edges).toEqual([expect.objectContaining({ source: page.id, target: selected.id, relation: "call" })]);
    const feature = discoverRepositoryFeatures(analysis).primary.find((item) => item.entryNodeId === page.id)!;
    expect(feature.nodeIds).toEqual([page.id, selected.id]);
    expect(buildRepositoryLearningGraph(analysis, feature.nodeIds).nodes.map((node) => node.technicalName)).toEqual(["Page", "selected"]);
    expect(buildLearningContext(analysis, { type: "function", functionId: page.id }).code.map((item) => item.functionName)).toEqual(["Page", "selected"]);
  });

  it("does not invent calls when a function is imported but only passed as a callback", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: "import { selected } from '../lib/actions'; export default function Page() { return <button onClick={selected}/>; }" },
      { path: "lib/actions.ts", content: "export function first() {} export function selected() {}" },
    ]);
    expect(analysis.edges.map((edge) => edge.relation)).toEqual(["import", "reference"]);
    expect(buildRepositoryLearningGraph(analysis).edges.map((edge) => edge.relation)).toEqual(["reference"]);
  });

  it("resolves direct files before index files independently of collection order", () => {
    const analysis = analyzeSourceFiles([
      { path: "lib/actions/index.ts", content: "export function selected() { return 'index'; }" },
      { path: "app/page.tsx", content: "import { selected } from '../lib/actions'; export default function Page() { return selected(); }" },
      { path: "lib/actions.ts", content: "export function selected() { return 'direct'; }" },
    ]);
    const call = analysis.edges.find((edge) => edge.relation === "call")!;
    expect(analysis.nodes.find((node) => node.id === call.target)?.filePath).toBe("lib/actions.ts");
    expect(analysis.edges.find((edge) => edge.relation === "import")?.target).toBe("file:lib/actions.ts");
  });

  it("does not resolve a missing app-local alias into a different repository root", () => {
    const analysis = analyzeSourceFiles([
      { path: "apps/store/app/page.tsx", content: "import { selected } from '@/lib/actions'; export default function Page() { return selected(); }" },
      { path: "src/lib/actions.ts", content: "export function selected() { return 'another app'; }" },
    ]);
    expect(analysis.edges).toEqual([]);
  });

  it("preserves inferred confidence rather than upgrading it in the learning transformation", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: "import { selected } from '../lib/actions'; export default function Page() { return selected(); }" },
      { path: "lib/actions.ts", content: "export function selected() { return 42; }" },
    ]);
    const call = analysis.edges.find((edge) => edge.relation === "call")!;
    call.confidence = "inferred";
    const graph = buildRepositoryLearningGraph(analysis);
    expect(graph.edges).toEqual([expect.objectContaining({ confidence: "inferred", label: "함수 호출 · 추정" })]);
    expect(graph.nodes.every((node) => node.confidence === "limited")).toBe(true);
    expect(graph.nodes.find((node) => node.technicalName === "selected")?.incomingRelations[0]).toContain("추정");
  });
});
