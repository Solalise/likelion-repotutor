import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { buildBehaviorFlow } from "./flowBuilder";
import { validateBehaviorFlow } from "./flowValidator";
import { nextLoginSources } from "./fixtures/nextLogin";

const analysis = analyzeSourceFiles(nextLoginSources);
const original = buildBehaviorFlow(analysis, analysis.entryPoints!.find(entry => entry.routePath === "/login")!);

describe("behavior provenance validator", () => {
  it("validates the generated projection", () => {
    expect(validateBehaviorFlow(original, analysis)).toEqual({ valid: true, errors: [] });
  });

  it.each(["runtime", "order", "confidence", "edge-id", "source", "target", "provenance"])("rejects an edge with forged %s", (change) => {
    const flow = structuredClone(original);
    const edge = flow.edges.find(item => item.sourceEdgeIds.length > 0)!;
    if (change === "runtime") edge.semantics = "runtime-observed";
    if (change === "order") edge.executionOrder = "established";
    if (change === "confidence") edge.confidence = "inferred";
    if (change === "edge-id") edge.id = "invented";
    if (change === "source") edge.source = "invented";
    if (change === "target") edge.target = "invented";
    if (change === "provenance") edge.sourceEdgeIds = [];
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(false);
  });

  it.each(["line", "file", "excerpt", "confidence"])("rejects evidence with a false %s", (change) => {
    const flow = structuredClone(original);
    const fact = flow.evidence.find(item => item.origin.kind === "relation" && item.confidence === "confirmed")!;
    if (change === "line") fact.location = { filePath: fact.location.filePath, precision: "line", startLine: 999, endLine: 999 };
    if (change === "file") fact.location.filePath = "invented.ts";
    if (change === "excerpt") fact.excerpt = "invented()";
    if (change === "confidence") fact.confidence = "inferred";
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(false);
  });

  it.each(["event", "condition", "data-access", "result"] as const)("rejects an unsupported %s role even when the original function exists", (kind) => {
    const flow = structuredClone(original);
    flow.nodes.find(node => node.kind === "function")!.kind = kind;
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(false);
  });

  it("rejects duplicate IDs, missing evidence, and an incomplete API request stage", () => {
    const duplicate = structuredClone(original);
    duplicate.nodes.push(structuredClone(duplicate.nodes[0]));
    expect(validateBehaviorFlow(duplicate, analysis).valid).toBe(false);
    const missing = structuredClone(original);
    missing.evidence = [];
    expect(validateBehaviorFlow(missing, analysis).valid).toBe(false);
    const incomplete = structuredClone(original);
    incomplete.edges = incomplete.edges.filter(edge => edge.relation !== "api-route");
    expect(validateBehaviorFlow(incomplete, analysis).valid).toBe(false);
  });

  it("rejects fabricated API metadata and versions", () => {
    const input = structuredClone(original);
    input.nodes.find(node => node.kind === "api-request")!.request!.path = "/api/invented";
    expect(validateBehaviorFlow(input, analysis).valid).toBe(false);
    const version = structuredClone(original);
    version.commitSha = "a-different-commit";
    expect(validateBehaviorFlow(version, analysis).valid).toBe(false);
  });

  it("accepts an explicit unavailable result without pretending it is a verified entry", () => {
    const flow = buildBehaviorFlow(analysis, { ...original.entryPoint, nodeId: "missing" });
    expect(flow.status).toBe("unavailable");
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(true);
    flow.nodes.push(original.nodes[0]);
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(false);
  });
});
