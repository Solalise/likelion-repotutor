import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { buildLearningGraph } from "@/lib/learning/learningGraphBuilder";
import { LearningFlow } from "./LearningFlow";
import { CodeFlow } from "./CodeFlow";
import { LearningInspector } from "@/components/repository/LearningInspector";
import { LearningNodeCard, type LearningFlowNode } from "./LearningNodeCard";
import type { NodeProps } from "@xyflow/react";

const captured = vi.hoisted(() => ({ props: undefined as unknown }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: unknown) => { captured.props = props; return null; },
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  ViewportPortal: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
  useNodesState: (nodes: unknown[]) => [nodes, () => {}, () => {}],
  useEdgesState: (edges: unknown[]) => [edges, () => {}, () => {}],
}));

interface FlowProps {
  nodes: Array<{ id: string; selected: boolean; position: { x: number; y: number } }>;
  edges: Array<{ source: string; target: string; label?: string }>;
  onNodeClick: (event: unknown, node: { id: string }) => void;
}
const flowProps = () => captured.props as FlowProps;

const actual = {
  ...analyzeSourceFiles([
    { path: "app/login/page.tsx", content: "export function LoginPage() { return login(); } function login() { return 'custom'; }" },
    { path: "app/api/orders/route.ts", content: "export function POST() { return 123; }" },
  ], "owner/repo"),
  source: "github" as const,
};

describe("learning and developer views", () => {
  beforeEach(() => { captured.props = undefined; });

  it("renders a prominent Korean role, actual identifier, basename and separate estimate badge", () => {
    const graph = buildLearningGraph(actual);
    const node = { ...graph.nodes[0], title: "동작 처리 후보", roleConfidence: "inferred" as const };
    const html = renderToStaticMarkup(<LearningNodeCard {...{ data: { learning: node }, selected: true } as NodeProps<LearningFlowNode>} />);
    expect(html).toContain("<strong>동작 처리 후보</strong>");
    expect(html).toContain("LoginPage()");
    expect(html).toContain(">page.tsx</small>");
    expect(html).toContain("역할 추정");
    expect(html).toContain("is-selected");
  });

  it("explains role facts, incoming and outgoing relation kinds beside original code and optional AI navigation", () => {
    const graph = buildLearningGraph({ ...analyzeSourceFiles([
      { path: "code.ts", content: "function main() { run(work); } function run(fn: unknown) { return fn; } function work() { return 'original-body'; }" },
    ]), source: "github" });
    const main = graph.nodes.find((node) => node.technicalName === "main")!;
    const work = graph.nodes.find((node) => node.technicalName === "work")!;
    const html = renderToStaticMarkup(<LearningInspector node={main} onExplain={() => {}} />);
    expect(html).toContain("확인된 사실과 역할 해석");
    expect(html).toContain("다음 연결");
    expect(html).toContain("함수 호출");
    expect(html).toContain("함수 참조·전달 (실행 미확정)");
    expect(html).toContain("기존 AI 설명으로 이동");
    const selected = renderToStaticMarkup(<LearningInspector node={work} />);
    expect(selected).toContain("이전 연결");
    expect(selected).toContain("original-body");
    expect(selected).toContain("실행 여부는 보장하지 않습니다");
    expect(selected).not.toContain("기존 AI 설명으로 이동");
  });

  it("uses dashed references and inferred relations without changing their direction or confidence", () => {
    const graph = buildLearningGraph(actual);
    const edge = { id: "ref", source: graph.nodes[0].id, target: graph.nodes[1].id, relation: "reference" as const, label: "함수 참조·전달 (실행 미확정)", confidence: "inferred" as const };
    renderToStaticMarkup(<LearningFlow learningNodes={graph.nodes} learningEdges={[edge]} onSelect={() => {}} />);
    expect(flowProps().edges[0]).toMatchObject({ source: edge.source, target: edge.target, label: edge.label, style: { strokeDasharray: "5 4" } });
    expect(edge.confidence).toBe("inferred");
  });

  it("lays out a real LoginPage by graph relationships rather than demo positions", () => {
    const graph = buildLearningGraph(actual);
    renderToStaticMarkup(<LearningFlow learningNodes={graph.nodes} learningEdges={graph.edges} onSelect={() => {}} />);
    const login = graph.nodes.find((node) => node.technicalName === "login")!;
    expect(flowProps().nodes.find((node) => node.id === login.id)?.position.y).toBe(175);
    expect(flowProps().nodes.find((node) => node.id === login.id)?.position.y).not.toBe(310);
  });

  it("preserves explicitly selected demo positions", () => {
    const names = ["LoginPage", "handleLogin", "login", "POST", "findUser"];
    const graph = buildLearningGraph({
      repository: "sample-repository", source: "sample", files: [], edges: [],
      nodes: names.map((name) => ({ id: name, name, type: "function", filePath: "sample.ts" })),
      stats: { files: 1, functions: 5, relations: 0 },
    });
    renderToStaticMarkup(<LearningFlow learningNodes={graph.nodes} learningEdges={graph.edges} onSelect={() => {}} />);
    expect(flowProps().nodes.find((node) => node.id === "login")?.position.y).toBe(310);
    expect(flowProps().nodes.find((node) => node.id === "POST")?.position.y).toBe(465);
  });

  it("keeps node selection, relationships and original code available in both views", () => {
    const graph = buildLearningGraph(actual);
    const selected = graph.nodes.find((node) => node.technicalName === "login")!;
    const onSelect = vi.fn();
    renderToStaticMarkup(<LearningFlow learningNodes={graph.nodes} learningEdges={graph.edges} selectedId={selected.id} onSelect={onSelect} />);
    expect(flowProps().nodes.find((node) => node.id === selected.id)?.selected).toBe(true);
    flowProps().onNodeClick({}, { id: selected.id });
    expect(onSelect).toHaveBeenCalledWith(selected.id);
    expect(flowProps().edges).toHaveLength(actual.edges.length);
    const html = renderToStaticMarkup(<LearningInspector node={selected} />);
    expect(html).toContain("custom");
    expect(html).toContain("추정");
    expect(html).not.toContain("JSON.stringify(input)");
    renderToStaticMarkup(<CodeFlow codeNodes={actual.nodes} codeEdges={actual.edges} selectedId={selected.id} onSelect={onSelect} />);
    expect(flowProps().nodes.find((node) => node.id === selected.id)?.selected).toBe(true);
    expect(flowProps().edges).toHaveLength(actual.edges.length);
    flowProps().onNodeClick({}, { id: selected.id });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(actual.nodes.find((node) => node.id === selected.id)?.sourceCode).toBe(selected.codeSnippet);
  });

  it("labels demo snippets as demo content and handles unavailable original code", () => {
    const graph = buildLearningGraph(actual);
    const node = graph.nodes[0];
    const html = renderToStaticMarkup(<LearningInspector node={{ ...node, source: "demo", nextStep: "데모 다음 단계" }} />);
    expect(html).toContain("데모 이해를 위한 보조 학습 단계");
    expect(html).toContain("데모 다음 단계");
    const missing = renderToStaticMarkup(<LearningInspector node={{ ...node, codeSnippet: undefined }} />);
    expect(missing).toContain("본문을 확보하지 못했습니다");
    expect(missing).not.toContain("데모 다음 단계");
    expect(renderToStaticMarkup(<LearningInspector node={{ ...node, confidence: "limited" }} />)).toContain("추정 관계");
  });

  it("keeps file imports in the developer view without adding learning execution edges", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: "import { unused } from '../lib/actions'; export function Page() { return <div/>; }" },
      { path: "lib/actions.ts", content: "export function unused() { return true; }" },
    ]);
    const graph = buildLearningGraph({ ...analysis, source: "github" });
    renderToStaticMarkup(<LearningFlow learningNodes={graph.nodes} learningEdges={graph.edges} onSelect={() => {}} />);
    expect(flowProps().edges).toEqual([]);
    renderToStaticMarkup(<CodeFlow codeNodes={analysis.nodes} codeEdges={analysis.edges} onSelect={() => {}} />);
    expect(flowProps().edges).toEqual([expect.objectContaining({ source: "file:app/page.tsx", target: "file:lib/actions.ts", label: "Import" })]);
  });
});
