import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { discoverRepositoryFeatures, repositoryFeatureEdges, traverseRepositoryFeature } from "@/lib/features/featureDiscovery";
import { buildRepositoryLearningGraph } from "./learningGraphBuilder";
import { generateLearningLabel } from "./labelGenerator";
import type { CodeNode } from "@/types/analysis";

const analysis = { ...analyzeSourceFiles([
  { path: "app/orders/page.tsx", content: "import { login } from '../../service'; export default function Page() { return <button onClick={login}>주문</button>; }" },
  { path: "app/other/page.tsx", content: "export default function Page() { return <div/>; }" },
  { path: "service.ts", content: "export function login() { return fetch('/api/orders', { method: 'POST' }); } export function findUser() { return 7; }" },
  { path: "app/api/orders/route.ts", content: "export function POST() { return Response.json({ order: true }); }" },
], "actual-fixture"), source: "github" as const };

describe("evidence based learning roles", () => {
  const graph = buildRepositoryLearningGraph(analysis);
  it("generates grounded Korean roles for RepoTutor's actual local page and API sources", () => {
    const paths = ["src/app/page.tsx", "src/app/api/analyze/route.ts"];
    const actual = { ...analyzeSourceFiles(paths.map((path) => ({ path, content: readFileSync(path, "utf8") })), "RepoTutor"), source: "github" as const };
    const result = buildRepositoryLearningGraph(actual);
    expect(result.nodes.find((node) => node.technicalName === "HomePage")).toMatchObject({ title: "페이지 진입점", roleConfidence: "confirmed", filePath: paths[0] });
    expect(result.nodes.find((node) => node.technicalName === "GET")).toMatchObject({ title: "서버 요청 처리", roleConfidence: "confirmed", filePath: paths[1] });
    const helper = result.nodes.find((node) => node.technicalName === "sourceBytes")!;
    expect(helper).toMatchObject({ title: "함수 코드 살펴보기", roleConfidence: "unknown" });
    expect(helper.codeSnippet).toContain("Buffer.byteLength");
  });
  it("uses route metadata and confirmed API relationships rather than business names", () => {
    const page = graph.nodes.find((node) => node.filePath === "app/orders/page.tsx")!;
    const request = graph.nodes.find((node) => node.technicalName === "login")!;
    const route = graph.nodes.find((node) => node.technicalName === "POST")!;
    expect(page).toMatchObject({ title: "페이지 진입점", roleConfidence: "confirmed" });
    expect(request).toMatchObject({ title: "서버 API 요청 연결", roleConfidence: "confirmed" });
    expect(route).toMatchObject({ title: "서버 요청 처리", roleConfidence: "confirmed" });
    expect(route.description).toContain("POST /api/orders");
    expect(route.codeSnippet).toContain("order: true");
    expect(JSON.stringify(graph)).not.toContain("비밀번호");
    expect(JSON.stringify(graph)).not.toContain("로그인 요청 처리");
  });
  it.each(["login", "findUser", "POST", "saveOrder"])("does not invent business meaning for %s", (name) => {
    const node: CodeNode = { id: name, name, type: "function", filePath: "logic.ts", sourceCode: `function ${name}() { return 7; }` };
    const label = generateLearningLabel(node);
    expect(label).toMatchObject({ title: "함수 코드 살펴보기", roleConfidence: "unknown" });
    expect(label.description).toContain(name);
    expect(label.description).not.toMatch(/인증|저장합니다|사용자를 조회/);
  });
  it("keeps role estimates separate from statically confirmed references", () => {
    const node: CodeNode = { id: "save", name: "handleSave", type: "function", filePath: "ui.tsx" };
    const label = generateLearningLabel(node, "analysis", { edges: [{ id: "ref", source: "page", target: "save", relation: "reference", confidence: "confirmed" }] });
    expect(label.roleConfidence).toBe("inferred");
    expect(label.roleBasis).toContain("추정");
    expect(label.facts?.join(" ")).toContain("실행 여부는 보장하지 않습니다");
  });
  it("never upgrades inferred API relations to a confirmed role", () => {
    const label = generateLearningLabel({ id: "a", name: "login", type: "function", filePath: "a.ts" }, "analysis", {
      edges: [{ id: "api", source: "a", target: "b", relation: "api", confidence: "inferred" }],
    });
    expect(label.roleConfidence).toBe("unknown");
    expect(label.facts).toEqual([]);
  });
  it("keeps reference meaning and original edge evidence", () => {
    const reference = graph.edges.find((edge) => edge.relation === "reference")!;
    expect(reference.label).toContain("실행 미확정");
    expect(reference.confidence).toBe("confirmed");
    expect(reference.occurrences?.[0].evidence).toContain("onClick");
    expect(graph.nodes.find((node) => node.id === reference.target)?.incomingRelations.join(" ")).toContain("함수 참조·전달");
  });
  it("preserves exact DFS projection, feature nodeIds and edgeIds at Depth 0–8", () => {
    const feature = discoverRepositoryFeatures(analysis).primary.find((feature) => feature.routePath === "/orders")!;
    const scoped = { ...analysis, edges: repositoryFeatureEdges(analysis, feature) };
    const complete = buildRepositoryLearningGraph(scoped, feature.nodeIds);
    const other = analysis.entryPoints!.find((entry) => entry.routePath === "/other")!.nodeId;
    for (let depth = 0; depth <= 8; depth++) {
      const result = traverseRepositoryFeature(analysis, feature, depth);
      const visible = buildRepositoryLearningGraph({ ...analysis, nodes: result.nodes, edges: result.edges });
      expect(visible.nodes.map((node) => node.id)).toEqual(result.nodes.filter((node) => node.type !== "file").map((node) => node.id));
      expect(visible.edges.map((edge) => [edge.source, edge.target, edge.confidence])).toEqual(result.edges.map((edge) => [edge.source, edge.target, edge.confidence]));
      expect(visible.nodes.some((node) => node.id === other)).toBe(false);
      expect(visible.nodes.every((node) => feature.nodeIds.includes(node.id))).toBe(true);
    }
    expect(complete.nodes.find((node) => node.technicalName === "login")?.outgoingRelations.join(" ")).toContain("API 요청");
  });
  it("does not describe excluded feature edges as confirmed role evidence", () => {
    const feature = discoverRepositoryFeatures(analysis).primary.find((feature) => feature.routePath === "/orders")!;
    const restricted = { ...feature, edgeIds: [] };
    const result = traverseRepositoryFeature(analysis, restricted, 8);
    const visible = buildRepositoryLearningGraph({ ...analysis, nodes: result.nodes, edges: result.edges });
    expect(visible.nodes.map((node) => node.id)).toEqual([feature.entryNodeId]);
    expect(visible.edges).toEqual([]);
    expect(visible.nodes[0].facts?.join(" ")).not.toContain("다른 컴포넌트를 사용하는");
  });
});
