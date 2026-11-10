import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { BehaviorFlow } from "@/types/behavior";
import type { SourceInput } from "@/types/analysis";
import { buildBehaviorFlow, buildBehaviorFlows } from "./flowBuilder";
import { validateBehaviorFlow } from "./flowValidator";
import { controlFlowSources } from "./fixtures/controlFlow";

const analysis = analyzeSourceFiles(controlFlowSources, "control-example");
const entry = analysis.entryPoints![0];
const handler = analysis.files[0].functions.find(fn => fn.name === "handle")!;
const base = buildBehaviorFlow(analysis, entry, { includeControlFlow: false });
const expanded = buildBehaviorFlow(analysis, entry);

describe("BehaviorFlow function control details", () => {
  it("attaches separate detail graphs without flattening their statements into outer behavior nodes/edges", () => {
    expect(expanded.nodes.map(node => [node.id, node.kind, node.label])).toEqual(base.nodes.map(node => [node.id, node.kind, node.label]));
    expect(expanded.edges.map(edge => [edge.id, edge.relation])).toEqual(base.edges.map(edge => [edge.id, edge.relation]));
    expect(expanded.nodes.find(node => node.sourceNodeIds[0] === handler.id && node.kind === "function")!.controlFlowId).toBeDefined();
    expect(expanded.controlFlows!.some(flow => flow.ownerFunctionId === handler.id)).toBe(true);
    expect(expanded.nodes.some(node => ["condition", "result", "data-access"].includes(node.kind))).toBe(false);
    expect(validateBehaviorFlow(expanded, analysis)).toEqual({ valid: true, errors: [] });
  });

  it("keeps event -> handler connections and every outer edge's non-runtime meaning", () => {
    expect(expanded.nodes.filter(node => node.kind === "event")).toHaveLength(1);
    expect(expanded.edges.some(edge => edge.relation === "event-handler")).toBe(true);
    expect(expanded.edges.every(edge => edge.executionOrder === "not-established" && edge.semantics === "static-relation")).toBe(true);
    const event = expanded.nodes.find(node => node.kind === "event")!;
    expect(event.controlFlowId).toBeUndefined();
  });

  it("supports selective function expansion by original AST ID", () => {
    const flow = buildBehaviorFlow(analysis, entry, { expandFunctionIds: [handler.id] });
    expect(flow.controlFlows!.map(item => item.ownerFunctionId)).toEqual([handler.id]);
    expect(flow.nodes.filter(node => node.controlFlowId)).toHaveLength(1);
  });

  it("annotates unreachable calls without deleting the existing static call relationship", () => {
    const after = analysis.files[0].functions.find(fn => fn.name === "after")!;
    const call = expanded.edges.find(edge => edge.relation === "call" && expanded.nodes.find(node => node.id === edge.target)?.sourceNodeIds[0] === after.id)!;
    expect(call).toBeDefined();
    expect(call.callContexts![0]).toMatchObject({ reachability: "unreachable-in-model", execution: "not-established" });
    expect(call.callContexts![0].graphNodeIds.length).toBeGreaterThan(0);
  });

  it("records true/false branch evidence for confirmed calls inside a condition", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: "function a() {} function b() {} export default function Page(flag: boolean) { if (flag) a(); else b(); }" }]);
    const flow = buildBehaviorFlow(input, input.entryPoints![0]);
    const names = new Map(flow.nodes.map(node => [node.id, node.label]));
    const yes = flow.edges.find(edge => edge.relation === "call" && names.get(edge.target) === "a")!;
    const no = flow.edges.find(edge => edge.relation === "call" && names.get(edge.target) === "b")!;
    expect(yes.callContexts![0].branchPath.map(guard => guard.branch)).toEqual(["true"]);
    expect(no.callContexts![0].branchPath.map(guard => guard.branch)).toEqual(["false"]);
    expect(yes.executionOrder).toBe("not-established");
  });

  it("keeps finally contexts on CFG instances rather than asserting a call count/order", () => {
    const cleanup = analysis.files[0].functions.find(fn => fn.name === "cleanup")!;
    const call = expanded.edges.find(edge => edge.relation === "call" && expanded.nodes.find(node => node.id === edge.target)?.sourceNodeIds[0] === cleanup.id)!;
    const detail = expanded.controlFlows!.find(item => item.id === call.callContexts![0].controlFlowId)!;
    const instances = call.callContexts![0].graphNodeIds.map(id => detail.nodes.find(node => node.id === id)!);
    expect(instances.length).toBeGreaterThan(1);
    expect(new Set(instances.map(node => node.context.at(-1)!.pendingCompletion))).toEqual(new Set(["return", "throw"]));
    expect(call.executionOrder).toBe("not-established");
  });

  it("does not mutate frozen analysis or metadata", () => {
    const input = structuredClone(analysis), before = JSON.stringify(input);
    function freeze(value: unknown) { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } }
    freeze(input);
    buildBehaviorFlows(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("supports analyses without CFG metadata and validates historical JSON outputs", async () => {
    const old = structuredClone(analysis); delete old.functionControlFlows;
    const flow = buildBehaviorFlow(old, entry);
    expect(flow.controlFlows).toBeUndefined();
    expect(flow.edges.some(edge => edge.relation === "event-handler")).toBe(true);
    for (const name of ["behavior-login.json", "behavior-react-events.json"]) {
      const artifact = JSON.parse(await readFile(`docs/examples/${name}`, "utf8")) as { input: SourceInput[]; output: BehaviorFlow };
      const input = analyzeSourceFiles(artifact.input, artifact.output.repository);
      expect(validateBehaviorFlow(artifact.output, input).valid).toBe(true);
    }
  });

  it.each(["source", "completion", "link", "guard"])("rejects forged detail %s", change => {
    const flow = structuredClone(expanded);
    const node = flow.nodes.find(node => node.controlFlowId && node.sourceNodeIds[0] === handler.id)!;
    const detail = flow.controlFlows!.find(item => item.id === node.controlFlowId)!;
    if (change === "source") detail.statements[0].sourceCode = "invented()";
    if (change === "completion") detail.edges[0].completion = "return";
    if (change === "link") node.controlFlowId = "invented";
    if (change === "guard") flow.edges.find(edge => edge.callContexts?.length)!.callContexts![0].branchPath = [{ conditionStatementId: "invented", branch: "true" }];
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(false);
  });
});
