import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { buildBehaviorFlow, buildBehaviorFlows } from "./flowBuilder";
import { createEvidenceMapper } from "./evidenceMapper";
import { validateBehaviorFlow } from "./flowValidator";
import { nextLoginSources } from "./fixtures/nextLogin";
import { reactEventSources } from "./fixtures/reactEvents";
import type { BehaviorFlow } from "@/types/behavior";
import type { SourceInput } from "@/types/analysis";

const analysis = analyzeSourceFiles(reactEventSources, "event-example");
const entry = analysis.entryPoints![0];
const flow = buildBehaviorFlow(analysis, entry);
const labels = (value: typeof flow) => new Map(value.nodes.map(node => [node.id, node.label]));

describe("event-enabled BehaviorFlow", () => {
  it("projects only confirmed DOM bindings with static, non-runtime semantics", () => {
    expect(flow.status).toBe("partial");
    expect(flow.nodes.filter(node => node.kind === "event")).toHaveLength(2);
    expect(flow.edges.filter(edge => edge.relation === "event-binding")).toHaveLength(2);
    expect(flow.edges.filter(edge => edge.relation === "event-handler")).toHaveLength(2);
    expect(flow.edges.every(edge => edge.executionOrder === "not-established" && edge.semantics === "static-relation")).toBe(true);
    expect(validateBehaviorFlow(flow, analysis)).toEqual({ valid: true, errors: [] });
  });

  it("links a page to its event site and the declared direct handler", () => {
    const event = flow.nodes.find(node => node.label === "<button> onClick 바인딩")!;
    const names = labels(flow);
    expect(flow.edges.some(edge => names.get(edge.source) === "LoginPage" && edge.target === event.id && edge.relation === "event-binding")).toBe(true);
    expect(flow.edges.some(edge => edge.source === event.id && names.get(edge.target) === "handleLogin" && edge.relation === "event-handler")).toBe(true);
    const fact = flow.evidence.find(item => event.evidenceIds.includes(item.id))!;
    expect(fact).toMatchObject({ origin: { kind: "event-binding" }, excerpt: "onClick={handleLogin}", location: { filePath: "app/login/page.tsx", startLine: 8 } });
    expect(fact.sourceEdgeIds).toEqual([]);
  });

  it("preserves an inline callback and fan-out calls without ordering them", () => {
    const binding = analysis.reactEventBindings!.find(item => item.eventName === "onSubmit")!;
    const callback = flow.nodes.find(node => node.sourceNodeIds[0] === binding.targetNodeId && node.kind === "function")!;
    const names = labels(flow);
    expect(flow.edges.filter(edge => edge.source === callback.id && edge.relation === "call").map(edge => names.get(edge.target)).sort()).toEqual(["audit", "submitForm"]);
    expect(flow.edges.some(edge => names.get(edge.source) === "submitForm" && names.get(edge.target) === "audit")).toBe(false);
    expect(flow.unresolved.some(item => item.targetName === "event.preventDefault")).toBe(true);
    expect(flow.nodes.some(node => ["condition", "data-access", "result"].includes(node.kind))).toBe(false);
  });

  it("retains conditional and component props as findings and ordinary references", () => {
    expect(flow.eventBindings!.some(item => item.status === "unresolved" && item.reason === "conditional-handler")).toBe(true);
    expect(flow.eventBindings!.some(item => item.status === "unresolved" && item.reason === "component-prop")).toBe(true);
    expect(flow.nodes.some(node => node.kind === "event" && node.label.includes("Button"))).toBe(false);
    expect(flow.edges.some(edge => edge.relation === "reference")).toBe(true);
  });

  it("keeps several bindings to one function separate even when the old reference edge merged", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: "function handler() {} export default function Page() { return <><button onClick={handler} onChange={handler}/><form onSubmit={handler}/></>; }" }]);
    expect(input.edges.filter(edge => edge.relation === "reference")).toHaveLength(1);
    const result = buildBehaviorFlow(input, input.entryPoints![0]);
    expect(result.nodes.filter(node => node.kind === "event")).toHaveLength(3);
    expect(result.edges.filter(edge => edge.relation === "event-handler")).toHaveLength(3);
    expect(result.eventBindings!.filter(item => item.status === "projected")).toHaveLength(3);
    expect(validateBehaviorFlow(result, input).valid).toBe(true);
  });

  it("keeps non-event JSX references unchanged", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: "function handler() {} function Child() { return <div/>; } export default function Page() { return <Child action={handler}/>; }" }]);
    const result = buildBehaviorFlow(input, input.entryPoints![0]);
    expect(result.nodes.some(node => node.kind === "event")).toBe(false);
    expect(result.edges.map(edge => edge.relation).sort()).toEqual(["component", "reference"]);
  });

  it("keeps a merged reference when identical DOM and custom component props share a line", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: "function handler() {} function Button() { return <div/>; } export default function Page() { return <><button onClick={handler}/><Button onClick={handler}/></>; }" }]);
    const result = buildBehaviorFlow(input, input.entryPoints![0]);
    expect(result.nodes.filter(node => node.kind === "event")).toHaveLength(1);
    expect(result.edges.filter(edge => edge.relation === "reference")).toHaveLength(1);
    expect(result.eventBindings!.some(item => item.reason === "component-prop")).toBe(true);
    expect(validateBehaviorFlow(result, input).valid).toBe(true);
  });

  it.each([{ maxNodes: 1 }, { maxEdges: 1 }, { maxDepth: 0 }])("does not create half event stages when a budget is exceeded", options => {
    const result = buildBehaviorFlow(analysis, entry, options);
    expect(result.nodes.some(node => node.kind === "event")).toBe(false);
    expect(result.eventBindings!.some(item => item.status === "excluded" && item.reason === "traversal-limit")).toBe(true);
    expect(validateBehaviorFlow(result, analysis).valid).toBe(true);
  });

  it("keeps stage-1 projection available and supports old analyses without event metadata", () => {
    const input = analyzeSourceFiles(nextLoginSources, "behavior-example");
    const legacy = buildBehaviorFlow(input, input.entryPoints!.find(item => item.routePath === "/login")!, { includeEvents: false });
    expect(legacy.nodes.filter(node => node.kind === "event")).toEqual([]);
    expect(legacy.edges.map(edge => edge.relation).sort()).toEqual(["api-request", "api-route", "call", "reference"].sort());
    const old = structuredClone(input); delete old.reactEventBindings;
    expect(buildBehaviorFlow(old, old.entryPoints!.find(item => item.routePath === "/login")!)).toEqual(legacy);
  });

  it("validates the historical stage-1 JSON without rewriting it", async () => {
    const artifact = JSON.parse(await readFile("docs/examples/behavior-login.json", "utf8")) as { input: SourceInput[]; output: BehaviorFlow };
    const input = analyzeSourceFiles(artifact.input, artifact.output.repository);
    expect(validateBehaviorFlow(artifact.output, input)).toEqual({ valid: true, errors: [] });
  });

  it("does not mutate AST metadata or frozen input", () => {
    const input = structuredClone(analysis);
    const before = JSON.stringify(input);
    function freeze(value: unknown) { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } }
    freeze(input);
    buildBehaviorFlows(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("maps exact event ranges and rejects forged offsets/tag classifications", () => {
    const binding = analysis.reactEventBindings!.find(item => item.status === "confirmed")!;
    const mapped = createEvidenceMapper(analysis).eventBinding(binding.id)!;
    expect(mapped.location).toMatchObject({ startOffset: binding.startOffset, endOffset: binding.endOffset, startColumn: binding.column, endColumn: binding.endColumn });
    const corrupted = structuredClone(analysis);
    corrupted.reactEventBindings!.find(item => item.id === binding.id)!.element.kind = "component";
    expect(createEvidenceMapper(corrupted).eventBinding(binding.id)).toBeUndefined();
  });

  it.each(["event-name", "handler", "offset", "event-id", "order", "fact", "finding"])("rejects forged event %s", change => {
    const result = structuredClone(flow);
    const event = result.nodes.find(node => node.kind === "event")!;
    const fact = result.evidence.find(item => event.evidenceIds.includes(item.id))!;
    if (fact.origin.kind !== "event-binding") throw new Error("expected event provenance");
    if (change === "event-name") fact.origin.binding.eventName = "onChange";
    if (change === "handler") fact.origin.binding.targetNodeId = entry.nodeId;
    if (change === "offset") fact.origin.binding.startOffset++;
    if (change === "event-id") event.eventBindingId = "invented";
    if (change === "order") result.edges.find(edge => edge.relation === "event-handler")!.executionOrder = "established";
    if (change === "fact") event.evidenceIds = [];
    if (change === "finding") result.eventBindings!.find(item => item.status === "projected")!.evidenceIds = [];
    expect(validateBehaviorFlow(result, analysis).valid).toBe(false);
  });

  it("rejects an event without its handler edge", () => {
    const result = structuredClone(flow);
    result.edges = result.edges.filter(edge => edge.relation !== "event-handler");
    expect(validateBehaviorFlow(result, analysis).valid).toBe(false);
  });

  it("checks real local RepoTutor JSX without UI/API integration", async () => {
    const paths = ["src/components/repository/FeaturePicker.tsx", "src/app/repository/page.tsx"];
    const sources = await Promise.all(paths.map(async filePath => ({ path: filePath, content: await readFile(filePath, "utf8") })));
    const input = analyzeSourceFiles(sources, "RepoTutor-event-subset");
    expect(input.reactEventBindings!.length).toBeGreaterThan(0);
    expect(input.reactEventBindings!.some(item => item.status === "confirmed" && item.mode === "inline")).toBe(true);
    expect(buildBehaviorFlows(input).flows.every(item => validateBehaviorFlow(item, input).valid)).toBe(true);
  });
});
