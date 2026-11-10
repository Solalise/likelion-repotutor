import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BehaviorWorkspace } from "./BehaviorWorkspace";
import { BehaviorGraph, behaviorDiagram } from "./BehaviorGraph";
import { queryBehavior } from "./behaviorClient";
import { splitBehaviorGraph } from "./behaviorPresentation";
import type { BehaviorGraphResponse, BehaviorCfgResponse } from "@/types/behaviorQuery";

const h = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, effectCursor: 0, effects: [] as Array<{ deps: unknown[]; cleanup?: () => void }>, pending: [] as Array<() => void>, graph: undefined as unknown }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useMemo: (f: () => unknown) => f(),
  useState: (value: unknown) => { const i = h.cursor++; if (!(i in h.states)) h.states[i] = value; return [h.states[i], (next: unknown) => { h.states[i] = typeof next === "function" ? next(h.states[i]) : next; }]; },
  useEffect: (f: () => (() => void) | undefined, deps: unknown[]) => { const i = h.effectCursor++, old = h.effects[i]; if (!old || deps.some((value, k) => !Object.is(value, old.deps[k]))) h.pending.push(() => { old?.cleanup?.(); h.effects[i] = { deps, cleanup: f() }; }); },
}));
vi.mock("@xyflow/react", () => ({ ReactFlow: (props: unknown) => { h.graph = props; return <div>actual graph adapter</div>; }, Handle: () => null, Background: () => null, Controls: () => null, Position: { Left: "left", Right: "right" }, MarkerType: { ArrowClosed: "arrow" } }));
const example = JSON.parse(readFileSync("docs/validation/behavior-delivery-example-stage4e.json", "utf8"));
const graph = example.firstGraph as BehaviorGraphResponse;
const first = example.features.features.find((f: { id: string }) => f.id === graph.featureId);
const summary = { ...example.features, features: [first] };
let fetchMock: ReturnType<typeof vi.fn>;
function render() { h.cursor = 0; h.effectCursor = 0; return BehaviorWorkspace({ source: { source: "connected", connectionId: "real-connection" } }); }
async function step() { render(); const effects = h.pending.splice(0); effects.forEach(f => f()); await new Promise(resolve => setImmediate(resolve)); return render(); }
function button(tree: ReactNode, text: string): React.ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(tree)) { for (const node of tree) { const found = button(node, text); if (found) return found; } }
  if (!React.isValidElement<{ children?: ReactNode; onClick: () => void }>(tree)) return;
  if (tree.type === "button" && renderToStaticMarkup(tree).includes(text)) return tree;
  return button(tree.props.children, text);
}
beforeEach(() => {
  h.states = []; h.effects = []; h.pending = []; h.graph = undefined;
  fetchMock = vi.fn(async (url: string) => {
    const view = new URL(url, "http://local").searchParams.get("view");
    const body = view === "features" ? summary : view === "flow" ? graph : { snapshot: graph.snapshot, featureId: graph.featureId, node: graph.nodes[0], sourceCodeNodeIds: ["original-function-id"], sourceFeatureId: "original-feature-id", code: { filePath: "app/page.tsx", startLine: 1, endLine: 2, startColumn: 1, endColumn: 4, text: "actual source from API", nextOffset: null }, reasons: [], cfg: { available: false }, facts: { items: [], total: 0 }, calls: { items: [], total: 0 }, bindings: { items: [], total: 0 }, evidence: { items: [], total: 0 } };
    return new Response(JSON.stringify(body), { status: 200 });
  }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { h.effects.forEach(effect => effect.cleanup?.()); vi.unstubAllGlobals(); });
describe("BehaviorFlow UI supply", () => {
  it("loads summaries only, fetches one selected Flow, then details only after a node click", async () => {
    let tree = await step(); expect(fetchMock).toHaveBeenCalledTimes(1); expect(String(fetchMock.mock.calls[0][0])).toContain("view=features");
    button(tree, first.name)!.props.onClick(); tree = await step();
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(String(fetchMock.mock.calls[1][0])).toContain("view=flow");
    expect(renderToStaticMarkup(tree)).toContain("초기 표시");
    renderToStaticMarkup(tree); (h.graph as { onNodeClick: (event: unknown, node: { id: string }) => void }).onNodeClick({}, { id: graph.nodes[0].id });
    tree = await step(); expect(fetchMock).toHaveBeenCalledTimes(3); expect(String(fetchMock.mock.calls[2][0])).toContain("view=node");
    expect(renderToStaticMarkup(tree)).toContain("actual source from API");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ACCESS_DENIED" } }), { status: 403 }));
    (h.graph as { onNodeClick: (event: unknown, node: { id: string }) => void }).onNodeClick({}, { id: graph.nodes[1].id });
    tree = await step(); const html = renderToStaticMarkup(tree); expect(html).not.toContain("actual source from API"); expect(html).toContain("접근 권한");
  });
  it("uses only server nodes/edges and preserves code-membership semantics", () => {
    const diagram = behaviorDiagram(graph);
    const split = splitBehaviorGraph(graph);
    expect(diagram.nodes.map(node => node.id)).toEqual(split.mainNodes.map(node => node.id));
    expect(diagram.edges.map(edge => [edge.id, edge.source, edge.target])).toEqual(split.mainEdges.map(edge => [edge.id, edge.source, edge.target]));
    expect(new Set([...split.mainEdges, ...split.auxiliaryEdges].map(edge => edge.id))).toEqual(new Set(graph.edges.map(edge => edge.id)));
    expect(diagram.edges.find(edge => graph.edges.find(raw => raw.id === edge.id)?.relation === "contains-site")?.label).not.toBe("함수 호출");
  });
  it("labels Yes/No only for explicit CFG branches", () => {
    const cfg = { nodeId: "owner", nodes: [{ id: "c1", kind: "statement", statementId: "s1", reachability: "reachable-in-model" }, { id: "c2", kind: "normal-exit", reachability: "unknown" }], statements: [{ id: "s1", kind: "if", condition: "user !== null" }], edges: [{ id: "e1", source: "c1", target: "c2", kind: "true", certainty: "structural" }, { id: "e2", source: "c1", target: "c2", kind: "false", certainty: "structural" }] } as unknown as BehaviorCfgResponse;
    expect(behaviorDiagram(graph, cfg).edges.map(edge => edge.label)).toEqual(["Yes", "No"]);
  });
  it("does not accept 202 progress as a successful summary response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ANALYSIS_IN_PROGRESS" } }), { status: 202 }));
    await expect(queryBehavior({ source: "sample" }, { view: "features" })).rejects.toMatchObject({ status: 202 });
  });
  it("keeps auxiliary relationships collapsed and selects their original neighbor ID", () => {
    const split = splitBehaviorGraph(graph), edge = split.auxiliaryEdges.find(edge => graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target))!;
    expect(edge).toBeDefined();
    const onSelect = vi.fn(), tree = BehaviorGraph({ graph, selectedId: edge.source, onSelect });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("선택 노드의 보조 관계 보기"); expect(html).toContain("<details>"); expect(html).not.toContain("<details open");
    const action = button(tree, "코드 확인")!; expect(action).toBeDefined(); action.props.onClick();
    const selected = onSelect.mock.calls[0][0];
    expect(split.auxiliaryEdges.some(item => (item.source === edge.source && item.target === selected) || (item.target === edge.source && item.source === selected))).toBe(true);
    expect(graph.nodes.some(node => node.id === selected)).toBe(true);
  });
});
