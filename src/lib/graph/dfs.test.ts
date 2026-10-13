import { describe, expect, it } from "vitest";
import type { CodeEdge, CodeNode } from "@/types/analysis";
import { traverseGraph, traverseGraphAround } from "./dfs";

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
});
