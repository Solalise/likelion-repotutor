import { describe, expect, it } from "vitest";
import type { CodeEdge, CodeNode, RepositoryAnalysis, TraversalResult } from "@/types/analysis";
import type { LearningGraph, LearningNode } from "@/types/learning";
import { aggregateDisplayEdges, traceDisplayGraph, traceRelevantGraph, traverseGraph, traverseGraphAround } from "./dfs";
import { buildRepositoryLearningGraph, selectLearningStageGraph, traverseLearningGraph } from "@/lib/learning/learningGraphBuilder";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "@/lib/features/featureDiscovery";
import { buildLearningContext } from "@/lib/ai/learningContext";

const nodes = (...ids: string[]): CodeNode[] => ids.map((id) => ({ id, name: id, type: "function", filePath: `${id}.ts` }));
const edge = (source: string, target: string, relation: CodeEdge["relation"] = "call", confidence: CodeEdge["confidence"] = "confirmed"): CodeEdge => ({ id: `${relation}:${source}->${target}`, source, target, relation, confidence });
const ids = (result: { nodes: Array<{ id: string }> }) => result.nodes.map((node) => node.id).sort();
function learning(items: CodeNode[], edges: CodeEdge[]): LearningGraph {
  return {
    nodes: items.map((item): LearningNode => ({ id: item.id, title: item.name, description: "", purpose: "", category: "logic", relatedFiles: [], connectionReason: "", incomingRelations: [], outgoingRelations: [], confidence: "limited", source: "ast" })),
    edges: edges.map((item) => ({ id: item.id, source: item.source, target: item.target, relation: item.relation === "api" ? "request" : item.relation, confidence: item.confidence })),
  };
}
function expectCounts(result: TraversalResult) {
  expect(result.hiddenNodeCount).toBe(result.reachableNodeCount! - result.nodes.length);
  expect(result.hiddenEdgeCount).toBe(result.reachableEdgeCount! - result.edges.length);
  expect(result.deferredNodeIds?.length).toBe(result.hiddenNodeCount);
  expect(result.hiddenNodeCount).toBe(result.collapsedNodeCount! + result.nodeLimitHiddenNodeCount! + result.edgeLimitHiddenNodeCount!);
  expect(new Set(result.nodes.map((node) => node.id)).size).toBe(result.nodes.length);
  expect(new Set(result.edges.map((edge) => edge.id)).size).toBe(result.edges.length);
}
const sharedNodes = nodes("root", "a", "b", "x", "y", "z");
const sharedEdges = [edge("root", "a"), edge("a", "b"), edge("b", "x"), edge("root", "x"), edge("x", "y"), edge("y", "z")];

describe("minimum-depth DFS reachability", () => {
  it("reopens a shared node reached first through a longer path", () => {
    for (const edges of [sharedEdges, [...sharedEdges].reverse()]) {
      expect(ids(traverseGraph("root", sharedNodes, edges, 2))).toEqual(["a", "b", "root", "x", "y"]);
      const display = traceDisplayGraph("root", sharedNodes, edges, { maxDepth: 2 });
      expect(ids(display)).toEqual(["a", "b", "root", "x", "y"]);
      expect(display.depthLimitedNodeCount).toBe(1);
      expect(display.hiddenNodeCount).toBe(0);
      expectCounts(display);
      expect(ids(traverseGraphAround("root", sharedNodes, edges, 2))).toEqual(["a", "b", "root", "x", "y"]);
      expect(ids(traceRelevantGraph("root", sharedNodes, edges, 2, 80))).toEqual(["a", "b", "root", "x", "y"]);
      expect(ids(traverseLearningGraph(learning(sharedNodes, edges), "root", 2))).toEqual(["a", "b", "root", "x", "y"]);
    }
  });

  it.each(Array.from({ length: 9 }, (_, depth) => depth))("uses the same depth-%i boundary regardless of edge order", (depth) => {
    const expected = depth === 0 ? ["root"] : depth === 1 ? ["a", "root", "x"] : depth === 2 ? ["a", "b", "root", "x", "y"] : ["a", "b", "root", "x", "y", "z"];
    const forward = traceDisplayGraph("root", sharedNodes, sharedEdges, { maxDepth: depth });
    const reversed = traceDisplayGraph("root", [...sharedNodes].reverse(), [...sharedEdges].reverse(), { maxDepth: depth });
    expect(ids(forward)).toEqual(expected);
    expect(ids(reversed)).toEqual(expected);
    expect(forward.edges.map((edge) => edge.id)).toEqual(reversed.edges.map((edge) => edge.id));
    if (depth === 0) expect(forward.edges).toEqual([]);
    expectCounts(forward);
  });

  it("terminates on cycles and self references without changing relationship meaning", () => {
    const items = nodes("root", "a", "b");
    const edges = [edge("root", "a", "reference", "inferred"), edge("a", "b"), edge("b", "root"), edge("root", "root")];
    const before = structuredClone(edges);
    const result = traceDisplayGraph("root", items, edges, { maxDepth: Infinity });
    expect(ids(result)).toEqual(["a", "b", "root"]);
    expect(result.edges).toHaveLength(4);
    expect(result.edges).toContainEqual(expect.objectContaining({ source: "root", target: "a", relation: "reference", confidence: "inferred" }));
    expect(edges).toEqual(before);
    expectCounts(result);
    expect(traverseGraph("root", items, edges, 0).edges).toEqual([]);
  });

  it("preserves both branches of a diamond and the common function's descendants", () => {
    const items = nodes("root", "left", "right", "shared", "leaf");
    const edges = [edge("root", "left"), edge("root", "right"), edge("left", "shared"), edge("right", "shared"), edge("shared", "leaf")];
    const graph = traverseLearningGraph(learning(items, edges), "root", 3);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(5);
    expect(traceDisplayGraph("root", items, edges, { maxDepth: 2 }).nodes.some((node) => node.id === "leaf")).toBe(false);
  });

  it("tracks component-fold state independently of a node's arrival depth", () => {
    const items = nodes("root", "a", "z", "shared", "leaf");
    const edges = [edge("root", "a"), edge("a", "shared", "component"), edge("root", "z", "component"), edge("z", "shared"), edge("shared", "leaf", "component")];
    const graph = traceDisplayGraph("root", items, edges, { maxDepth: 3 });
    expect(ids(graph)).toEqual(["a", "leaf", "root", "shared", "z"]);
    expectCounts(graph);
  });

  it("uses iterative DFS for a deep graph and counts Depth exclusions separately", () => {
    const items = nodes(...Array.from({ length: 12_000 }, (_, index) => `n${String(index).padStart(5, "0")}`));
    const edges = items.slice(1).map((item, index) => edge(items[index].id, item.id));
    const graph = traceDisplayGraph(items[0].id, items, edges, { maxDepth: 8 });
    expect(graph.nodes).toHaveLength(9);
    expect(graph.depthLimitedNodeCount).toBe(11_991);
    expect(graph.hiddenNodeCount).toBe(0);
    expectCounts(graph);
  });

  it("handles invalid roots/depths and zero budgets without fabricating nodes", () => {
    expect(traceDisplayGraph("missing", sharedNodes, sharedEdges).nodes).toEqual([]);
    expect(traceDisplayGraph("root", sharedNodes, sharedEdges, { maxDepth: -1 }).nodes).toEqual([]);
    expect(traceDisplayGraph("root", sharedNodes, sharedEdges, { maxDepth: NaN }).nodes).toEqual([]);
    const zero = traceDisplayGraph("root", sharedNodes, sharedEdges, { maxNodes: 0 });
    expect(zero.nodes).toEqual([]);
    expectCounts(zero);
    expect(traverseLearningGraph(learning(sharedNodes, sharedEdges), "root", 8, 0)).toEqual({ nodes: [], edges: [] });
  });

  it("matches an independent breadth-first depth oracle on branching cyclic graphs", () => {
    let seed = 731;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let sample = 0; sample < 20; sample++) {
      const items = nodes(...Array.from({ length: 10 }, (_, index) => `n${index}`));
      const edges = items.flatMap((source) => items.filter(() => random() < 0.2).map((target) => edge(source.id, target.id)));
      const distances = new Map([["n0", 0]]);
      const queue = ["n0"];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const item of edges.filter((candidate) => candidate.source === queue[cursor])) {
          if (distances.has(item.target)) continue;
          distances.set(item.target, distances.get(queue[cursor])! + 1);
          queue.push(item.target);
        }
      }
      for (let depth = 0; depth <= 4; depth++) {
        const expected = [...distances].filter(([, distance]) => distance <= depth).map(([id]) => id).sort();
        for (const order of [edges, [...edges].reverse()]) {
          const result = traceDisplayGraph("n0", items, order, { maxDepth: depth, maxNodes: 80, maxEdges: 140 });
          expect(ids(result)).toEqual(expected);
          expect(result.hiddenNodeCount).toBe(0);
          expectCounts(result);
        }
      }
    }
  });

  it("ignores imports, dangling targets and incoming-only branches in execution projections", () => {
    const items = nodes("root", "leaf", "outside");
    const result = traceDisplayGraph("root", items, [edge("root", "leaf", "reference", "inferred"), edge("root", "outside", "import"), edge("outside", "root"), edge("root", "missing")]);
    expect(ids(result)).toEqual(["leaf", "root"]);
    expect(result.edges).toEqual([expect.objectContaining({ relation: "reference", confidence: "inferred" })]);
    expectCounts(result);
  });
});

describe("bounded display stability", () => {
  const starNodes = nodes("root", ...Array.from({ length: 30 }, (_, index) => `n${String(index).padStart(2, "0")}`));
  const starEdges = starNodes.slice(1).map((node) => edge("root", node.id));

  it("counts every node/edge hidden by the node limit, including descendants", () => {
    const items = nodes("root", "a", "b", "c", "d");
    const edges = [edge("root", "a"), edge("a", "b"), edge("b", "c"), edge("c", "d")];
    const graph = traceDisplayGraph("root", items, edges, { maxDepth: 4, maxNodes: 2 });
    expect(graph.hiddenNodeCount).toBe(3);
    expect(graph.hiddenEdgeCount).toBe(3);
    expect(graph.nodeLimitHiddenNodeCount).toBe(3);
    expect(graph.depthLimitedNodeCount).toBe(0);
    expectCounts(graph);
  });

  it("counts edge-limited nodes without leaving disconnected cards", () => {
    for (const maxEdges of [0, 1, 2]) {
      const graph = traceDisplayGraph("root", sharedNodes, sharedEdges, { maxDepth: 8, maxNodes: 80, maxEdges });
      expect(graph.edges.length).toBeLessThanOrEqual(maxEdges);
      expect(graph.edgeLimitHiddenNodeCount).toBe(sharedNodes.length - graph.nodes.length);
      expect(ids(traverseGraph("root", graph.nodes, graph.edges, 8))).toEqual(ids(graph));
      expectCounts(graph);
    }
  });

  it("keeps the selected node and its connector path when another branch unfolds", () => {
    const items = nodes("root", "a", "z", ...Array.from({ length: 35 }, (_, index) => `child${index}`));
    const edges = [edge("root", "a", "component"), edge("root", "z", "component"), ...items.slice(3).map((node) => edge("a", node.id, "component"))];
    const initial = traceDisplayGraph("root", items, edges, { selectedNodeId: "z" });
    expect(ids(initial)).toEqual(["a", "root", "z"]);
    const expanded = traceDisplayGraph("root", items, edges, { selectedNodeId: "z", expandedNodeIds: ["a"] });
    expect(expanded.nodes).toHaveLength(28);
    expect(expanded.nodes.some((node) => node.id === "z")).toBe(true);
    expect(expanded.edges).toContainEqual(expect.objectContaining({ source: "root", target: "z" }));
    expectCounts(initial); expectCounts(expanded);
  });

  it("does not inflate display budgets using unknown expansion IDs", () => {
    const initial = traceDisplayGraph("root", starNodes, starEdges);
    const invalid = traceDisplayGraph("root", starNodes, starEdges, { expandedNodeIds: ["outside", "missing"], selectedNodeId: "outside" });
    expect(invalid).toEqual(initial);
    const expanded = traceDisplayGraph("root", starNodes, starEdges, { expandedNodeIds: ["root"] });
    expect(expanded.nodes).toHaveLength(28);
    expect(expanded.hiddenNodeCount).toBe(3);
    expectCounts(expanded);
  });

  it("projects the same expansion set consistently regardless of expansion request order", () => {
    const branches = Array.from({ length: 20 }, (_, branch) => Array.from({ length: 4 }, (_, step) => `b${String(branch).padStart(2, "0")}_${step}`));
    const items = nodes("root", ...branches.flat());
    const edges = branches.flatMap((branch) => branch.map((id, index) => edge(index === 0 ? "root" : branch[index - 1], id)));
    const expanded = branches.map((branch) => branch[3]);
    const forward = traceDisplayGraph("root", items, edges, { maxDepth: 4, expandedNodeIds: expanded });
    const reversed = traceDisplayGraph("root", items, edges, { maxDepth: 4, expandedNodeIds: [...expanded].reverse() });
    expect(forward).toEqual(reversed);
    expect(forward.nodes).toHaveLength(80);
    expectCounts(forward);
  });

  it("counts all component-folded descendants separately from display limits", () => {
    const items = nodes("root", "child", "grandchild", "leaf");
    const edges = [edge("root", "child", "component"), edge("child", "grandchild", "component"), edge("grandchild", "leaf")];
    const folded = traceDisplayGraph("root", items, edges, { maxDepth: 5 });
    expect(folded.collapsedNodeCount).toBe(2);
    expect(folded.hiddenNodeCount).toBe(2);
    expect(folded.hiddenEdgeCount).toBe(2);
    const expanded = traceDisplayGraph("root", items, edges, { maxDepth: 5, expandedNodeIds: ["child"] });
    expect(expanded.nodes).toHaveLength(4);
    expectCounts(folded); expectCounts(expanded);
  });

  it("deduplicates IDs and call occurrences conservatively without mutating source data", () => {
    const items = nodes("root", "leaf");
    const confirmed = { ...edge("root", "leaf"), line: 1, evidence: "leaf()" };
    const inferred = { ...confirmed, id: "other-call", line: 2, confidence: "inferred" as const };
    const before = structuredClone([confirmed, inferred]);
    const graph = traceDisplayGraph("root", [...items, { ...items[1] }], [confirmed, { ...confirmed }, inferred]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].confidence).toBe("inferred");
    expect(graph.edges[0].occurrences).toHaveLength(2);
    const twice = aggregateDisplayEdges([...graph.edges, ...graph.edges]);
    expect(twice[0].occurrences).toHaveLength(2);
    expect([confirmed, inferred]).toEqual(before);
    expectCounts(graph);
  });

  it("avoids display ID collisions when node IDs contain arrow separators", () => {
    const grouped = aggregateDisplayEdges([edge("a->b", "c"), { ...edge("a", "b->c"), id: "distinct" }]);
    expect(grouped).toHaveLength(2);
    expect(new Set(grouped.map((edge) => edge.id)).size).toBe(2);
  });

  it("deduplicates learning cards, relations and stage projections while retaining occurrence evidence", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: "export default function Page() {\nwork();\nwork();\nreturn <div/>;\n}\nfunction work() {}" }]);
    const root = analysis.nodes.find((node) => node.name === "Page")!;
    analysis.nodes.push({ ...root });
    const calls = analysis.edges.filter((item) => item.relation === "call");
    calls[1].confidence = "inferred";
    analysis.edges.push({ ...calls[0] });
    const original = structuredClone(analysis);
    const graph = buildRepositoryLearningGraph(analysis);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ confidence: "inferred", label: "함수 호출 · 추정" });
    expect(graph.edges[0].occurrences).toHaveLength(2);
    const duplicates = { nodes: [...graph.nodes, graph.nodes[0]], edges: [...graph.edges, graph.edges[0]] };
    const stage = { id: "test", kind: "overview" as const, title: "", description: "", nodeIds: ["missing", root.id, root.id] };
    expect(selectLearningStageGraph(duplicates, stage).nodes).toHaveLength(2);
    expect(selectLearningStageGraph(duplicates, stage).edges).toHaveLength(1);
    expect(analysis).toEqual(original);
  });
});

describe("feature scope and AI compatibility", () => {
  function repository(): RepositoryAnalysis {
    return analyzeSourceFiles([
      { path: "app/login/page.tsx", content: "import { shared } from '../../shared'; export default function Page() { shared(); return <div/>; }" },
      { path: "app/signup/page.tsx", content: "import { shared } from '../../shared'; export default function Page() { shared(); return <div/>; }" },
      { path: "shared.ts", content: "export function shared() { return leaf(); } function leaf() { return true; }" },
    ]);
  }

  it("honours both nodeIds and edgeIds even when extra nodes or edges exist", () => {
    const analysis = repository();
    const discovery = discoverRepositoryFeatures(analysis);
    const login = discovery.primary.find((feature) => feature.routePath === "/login")!;
    const signup = discovery.primary.find((feature) => feature.routePath === "/signup")!;
    const shared = analysis.nodes.find((node) => node.name === "shared")!;
    analysis.edges.push(edge(login.entryNodeId, signup.entryNodeId));
    const scope = { ...login, nodeIds: [...login.nodeIds, signup.entryNodeId], edgeIds: login.edgeIds!.filter((id) => !analysis.edges.some((item) => item.id === id && item.target === shared.id)) };
    const result = traverseRepositoryFeature(analysis, scope, 8, [shared.id, signup.entryNodeId], signup.entryNodeId);
    expect(ids(result)).toEqual([login.entryNodeId]);
    expect(result.edges).toEqual([]);
    expect(result.reachableNodeCount).toBe(1);
    expectCounts(result);
  });

  it("preserves original feature data and AI context across depth changes and expansion", () => {
    const analysis = repository();
    const feature = discoverRepositoryFeatures(analysis).primary.find((item) => item.routePath === "/login")!;
    const context = buildLearningContext(analysis, { type: "feature", feature });
    const before = structuredClone(analysis);
    const featureBefore = structuredClone(feature);
    for (const depth of [0, 8, 1, 5, 0, 8]) {
      const result = traverseRepositoryFeature(analysis, feature, depth, [feature.entryNodeId], feature.entryNodeId);
      expect(result.nodes.every((node) => feature.nodeIds.includes(node.id))).toBe(true);
      expect(result.edges.every((item) => item.occurrences?.every((occurrence) => feature.edgeIds!.includes(occurrence.edgeId)))).toBe(true);
      expectCounts(result);
    }
    expect(analysis).toEqual(before);
    expect(feature).toEqual(featureBefore);
    expect(buildLearningContext(analysis, { type: "feature", feature })).toEqual(context);
  });
});
