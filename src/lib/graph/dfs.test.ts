import { describe, expect, it } from "vitest";
import type { CodeEdge, CodeNode } from "@/types/analysis";
import { aggregateDisplayEdges, traceDisplayGraph, traceRelevantGraph, traverseGraph, traverseGraphAround } from "./dfs";

const nodes: CodeNode[] = ["a", "b", "c", "d"].map((id) => ({ id, type: "function", name: id, filePath: `${id}.ts` }));
const edges: CodeEdge[] = [
  { id: "a-b", source: "a", target: "b", relation: "call" },
  { id: "b-c", source: "b", target: "c", relation: "call" },
  { id: "c-a", source: "c", target: "a", relation: "call" },
  { id: "c-d", source: "c", target: "d", relation: "call" },
];

describe("traverseGraph", () => {
  it("respects depth and terminates on cycles", () => {
    expect(traverseGraph("a", nodes, edges, 1).nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(traverseGraph("a", nodes, edges, 5).nodes).toHaveLength(4);
  });

  it("can inspect real incoming and outgoing relations around a selected leaf", () => {
    const result = traverseGraphAround("d", nodes, edges, 1);
    expect(result.nodes.map((node) => node.id)).toEqual(["c", "d"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["c-d"]);
  });

  it("prioritizes relevant paths, records traversal state, and defers overflow", () => {
    const result = traceRelevantGraph("a", nodes, edges, 5, 3);
    expect(result.nodes).toHaveLength(3);
    expect(result.traversalStates?.a).toBe("Used");
    expect(result.deferredNodeIds).toContain("d");
    expect(result.edges.every((edge) => result.nodes.some((node) => node.id === edge.source)
      && result.nodes.some((node) => node.id === edge.target))).toBe(true);
  });

  it("keeps execution direction without expanding incoming parents or sibling components", () => {
    const graphNodes: CodeNode[] = ["parent", "root", "handler", "service", "api", "sibling", "child", "grandchild"]
      .map((id) => ({ id, type: id === "root" || id === "child" || id === "grandchild" ? "component" : "function", name: id, filePath: `${id}.ts` }));
    const graphEdges: CodeEdge[] = [
      { id: "parent-root", source: "parent", target: "root", relation: "component" },
      { id: "parent-sibling", source: "parent", target: "sibling", relation: "reference" },
      { id: "root-handler", source: "root", target: "handler", relation: "reference", evidence: "onConfirm={handler}" },
      { id: "handler-service", source: "handler", target: "service", relation: "call" },
      { id: "service-api", source: "service", target: "api", relation: "api" },
      { id: "root-child", source: "root", target: "child", relation: "component" },
      { id: "child-grandchild", source: "child", target: "grandchild", relation: "component" },
      { id: "import", source: "root", target: "sibling", relation: "import" },
    ];
    const result = traceDisplayGraph("root", graphNodes, graphEdges, { maxDepth: 5 });
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["root", "handler", "service", "api", "child"]));
    expect(result.nodes.map((node) => node.id)).not.toEqual(expect.arrayContaining(["parent", "sibling", "grandchild"]));
    expect(result.edges.map((edge) => edge.id)).not.toContain("import");
  });

  it("aggregates repeated display edges while preserving every line and evidence", () => {
    const repeated: CodeEdge[] = [10, 20, 30].map((line) => ({
      id: `call-${line}`, source: "a", target: "b", relation: "call", line, evidence: `b() at ${line}`,
    }));
    const display = aggregateDisplayEdges(repeated);
    expect(display).toHaveLength(1);
    expect(display[0].occurrences).toEqual([
      expect.objectContaining({ line: 10, evidence: "b() at 10" }),
      expect.objectContaining({ line: 20, evidence: "b() at 20" }),
      expect.objectContaining({ line: 30, evidence: "b() at 30" }),
    ]);
  });

  it("applies depth, bounds the initial graph, keeps valid endpoints and restores hidden neighbours on expansion", () => {
    const stressNodes: CodeNode[] = ["root", ...Array.from({ length: 30 }, (_, index) => `n${String(index).padStart(2, "0")}`)]
      .map((id) => ({ id, type: "function", name: id, filePath: `${id}.ts` }));
    const stressEdges: CodeEdge[] = [
      ...stressNodes.slice(1).map((node) => ({ id: `root-${node.id}`, source: "root", target: node.id, relation: "call" as const })),
      ...Array.from({ length: 10 }, (_, index) => ({ id: `repeat-${index}`, source: "root", target: "n00", relation: "call" as const, line: index + 1 })),
    ];
    const shallow = traceDisplayGraph("root", stressNodes, stressEdges, { maxDepth: 0 });
    const initial = traceDisplayGraph("root", stressNodes, stressEdges, { maxDepth: 5 });
    const expanded = traceDisplayGraph("root", stressNodes, stressEdges, { maxDepth: 5, expandedNodeIds: ["root"] });

    expect(shallow.nodes).toHaveLength(1);
    expect(initial.nodes).toHaveLength(18);
    expect(initial.edges).toHaveLength(17);
    expect(initial.hiddenNodeCount).toBe(13);
    expect(initial.hiddenEdgeCount).toBe(13);
    expect(initial.edges.find((edge) => edge.target === "n00")?.occurrences).toHaveLength(11);
    expect(initial.edges.every((edge) => initial.nodes.some((node) => node.id === edge.source)
      && initial.nodes.some((node) => node.id === edge.target))).toBe(true);
    expect(expanded.nodes).toHaveLength(28);
    expect(expanded.edges).toHaveLength(27);
    expect(expanded.hiddenNodeCount).toBeLessThan(initial.hiddenNodeCount!);
    expect(expanded.hiddenEdgeCount).toBeLessThan(initial.hiddenEdgeCount!);
    expect(stressNodes).toHaveLength(31);
    expect(stressEdges).toHaveLength(40);
  });
});
