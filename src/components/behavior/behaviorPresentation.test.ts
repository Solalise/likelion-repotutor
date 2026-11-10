import { beforeAll, describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { clearQueryCaches, getFlowIndex, summaries } from "@/lib/behavior/query/store";
import { graphPage, nodeDetail } from "@/lib/behavior/query/projector";
import { behaviorNodeTitle, selectedAuxiliaryEdges, splitBehaviorGraph } from "./behaviorPresentation";
import sources from "./fixtures/directionsSources.json";
import type { BehaviorGraphResponse, BehaviorNodeDetail } from "@/types/behaviorQuery";

// Four reviewed GitHub blobs, not a claim of full-repository or live-browser coverage.
const analysis = analyzeSourceFiles(sources, "team-mallang/likelion-hackathon");
let graph: BehaviorGraphResponse;
let detail204: BehaviorNodeDetail;
let detail205: BehaviorNodeDetail;
beforeAll(async () => {
  clearQueryCaches();
  const subject = { scope: "directions-presentation-test", version: sources[1].sha, source: "sample" as const, analysis };
  const feature = summaries(subject).find(item => item.entryPoint.routePath === "/case/directions")!;
  const { index } = await getFlowIndex(subject, feature.id);
  graph = graphPage(index, 64);
  const first = index.nodes.find(node => node.label.startsWith("callback@204:"))!;
  const second = index.nodes.find(node => node.label.startsWith("callback@205:"))!;
  detail204 = nodeDetail(index, analysis, first.id);
  detail205 = nodeDetail(index, analysis, second.id);
});

describe("DirectionsScreen evidence-preserving presentation", () => {
  it("keeps the route and confirmed component links while folding references and their descendants", () => {
    const split = splitBehaviorGraph(graph);
    expect(split.mainNodes.some(node => node.label === "DirectionsRoute")).toBe(true);
    expect(split.mainNodes.some(node => node.label === "DirectionsScreen")).toBe(true);
    expect(split.mainEdges.some(edge => edge.relation === "component")).toBe(true);
    expect(split.mainEdges.some(edge => edge.relation === "reference")).toBe(false);
    expect(split.mainNodes.some(node => node.id === detail204.node.id)).toBe(false);
    expect(split.auxiliaryEdges.some(edge => edge.target === detail204.node.id)).toBe(true);
  });
  it("preserves separate callback IDs and exact API code locations even for identical bodies", () => {
    expect(detail204.node.id).not.toBe(detail205.node.id);
    expect(detail204.sourceCodeNodeIds[0]).not.toBe(detail205.sourceCodeNodeIds[0]);
    expect(detail204.code?.startLine).toBe(204); expect(detail205.code?.startLine).toBe(205);
    expect(detail204.code?.text).toBe(detail205.code?.text);
    expect(behaviorNodeTitle(detail204.node, detail204, graph)).toContain("DirectionsScreen.tsx:204");
    expect(behaviorNodeTitle(detail205.node, detail205, graph)).toContain("DirectionsScreen.tsx:205");
    expect(behaviorNodeTitle(detail204.node, undefined, graph)).not.toContain("callback@");
    expect(behaviorNodeTitle(detail204.node, detail204, graph)).not.toContain("도착 확인");
  });
  it("allows selected-node-only exploration of folded references without adding links", () => {
    const screen = graph.nodes.find(node => node.label === "DirectionsScreen")!;
    const around = selectedAuxiliaryEdges(graph, screen.id);
    expect(around.some(edge => edge.target === detail204.node.id)).toBe(true);
    expect(around.some(edge => edge.target === detail205.node.id)).toBe(true);
    const callback = selectedAuxiliaryEdges(graph, detail204.node.id);
    expect(callback.every(edge => edge.source === detail204.node.id || edge.target === detail204.node.id)).toBe(true);
    expect(callback.every(edge => graph.edges.includes(edge))).toBe(true);
    expect(selectedAuxiliaryEdges(graph, "foreign-node")).toEqual([]);
  });
  it("retains every original record and keeps analysis truncation separate from folding", () => {
    const before = JSON.stringify(graph), split = splitBehaviorGraph(graph);
    expect(new Set([...split.mainNodes, ...split.auxiliaryNodes].map(node => node.id))).toEqual(new Set(graph.nodes.map(node => node.id)));
    expect(new Set([...split.mainEdges, ...split.auxiliaryEdges].map(edge => edge.id))).toEqual(new Set(graph.edges.map(edge => edge.id)));
    expect(JSON.stringify(graph)).toBe(before);
    const limited = { ...graph, truncation: { ...graph.truncation, analysis: true, reasons: ["traversal-limit"] } };
    expect(splitBehaviorGraph(limited).mainNodes.map(node => node.id)).toEqual(split.mainNodes.map(node => node.id));
    expect(limited.truncation.analysis).toBe(true);
  });
  it("does not promote inferred or unknown relationship types to the main graph", () => {
    const weak = { ...graph, edges: graph.edges.map(edge => ({ ...edge, confidence: "inferred" })) };
    expect(splitBehaviorGraph(weak).mainNodes.map(node => node.id)).toEqual([graph.rootId]);
    const unknown = { ...graph, edges: graph.edges.map(edge => ({ ...edge, relation: "future-dynamic-relation" })) };
    expect(splitBehaviorGraph(unknown).mainEdges).toEqual([]);
  });
});
