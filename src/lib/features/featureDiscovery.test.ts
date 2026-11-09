import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "./featureDiscovery";

describe("discoverRepositoryFeatures", () => {
  it("retains existing mobile app/index file routes without promoting their screen components", () => {
    const analysis = analyzeSourceFiles([
      { path: "apps/mobile/app/case/document-scan/index.tsx", content: "import { DocumentScreen } from '../../../src/screens/DocumentScreen'; export default function DocumentRoute() { return <DocumentScreen/>; }" },
      { path: "apps/mobile/src/screens/DocumentScreen.tsx", content: "export function DocumentScreen() { return <button/>; }" },
      { path: "apps/mobile/app/case/lookup/index.tsx", content: "export default function LookupRoute() { return <div/>; }" },
      { path: "apps/mobile/plugins/build.ts", content: "export function createGradleBlock() { return true; }" },
    ]);
    const result = discoverRepositoryFeatures(analysis);
    const features = [...result.primary, ...result.limited];
    expect(features.map((feature) => feature.routePath).sort()).toEqual(["/case/document-scan", "/case/lookup"]);
    expect(features.map((feature) => feature.technicalName)).not.toContain("DocumentScreen");
    const feature = features.find((item) => item.routePath === "/case/document-scan")!;
    expect(feature.nodeIds.map((id) => analysis.nodes.find((node) => node.id === id)?.name)).toEqual(["DocumentRoute", "DocumentScreen"]);
    expect(result.hidden.map((feature) => feature.technicalName)).toContain("createGradleBlock");
  });

  it("preserves original directed relationships, evidence and confidence in the selected graph", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: "export default function Page() { const handle = () => work(); return <button onClick={handle}/>; } function work() {}" }]);
    const feature = discoverRepositoryFeatures(analysis).primary[0];
    const graph = traverseRepositoryFeature(analysis, feature, 3);
    expect(graph.edges.map((edge) => edge.relation).sort()).toEqual(["call", "reference"]);
    expect(graph.edges.every((edge) => edge.confidence === "confirmed" && edge.evidence)).toBe(true);
    expect(graph.edges.every((edge) => analysis.edges.some((original) => original.source === edge.source && original.target === edge.target && original.relation === edge.relation))).toBe(true);
    expect(feature.description).toContain("참조");
    expect(feature.description).toContain("실행을 뜻하지 않으며");
  });

  it("lists exported API handlers independently and keeps providers and screens internal", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: "import { CaseProvider } from '../src/provider'; export default function Page() { return <CaseProvider/>; }" },
      { path: "src/provider.tsx", content: "export function CaseProvider() { return <div/>; } export function CaseSearchScreen() { return <div/>; }" },
      { path: "app/api/users/route.ts", content: "export function GET() {} export function POST() {} function DELETE() {}" },
    ]);
    const result = discoverRepositoryFeatures(analysis);
    expect([...result.primary, ...result.limited].map((feature) => feature.technicalName).sort()).toEqual(["GET", "POST", "Page"]);
    expect(result.hidden.map((feature) => feature.technicalName)).toEqual(expect.arrayContaining(["CaseSearchScreen", "DELETE"]));
  });

  it("supports explicit mappings without generating synthetic connections", () => {
    const analysis = analyzeSourceFiles([{ path: "src/domain/custom.ts", content: "export function CustomFlow() {} export function runCustomFlow() {}" }]);
    const entry = analysis.nodes.find((node) => node.name === "CustomFlow")!;
    const internal = analysis.nodes.find((node) => node.name === "runCustomFlow")!;
    const result = discoverRepositoryFeatures(analysis, { mappings: [{ entryNodeId: entry.id, title: "사용자 지정 흐름", includeNodeIds: [internal.id, "missing"] }] });
    expect(result.limited[0]).toMatchObject({ title: "사용자 지정 흐름", entryKind: "manual", nodeIds: [entry.id, internal.id], edgeIds: [] });
  });
});
