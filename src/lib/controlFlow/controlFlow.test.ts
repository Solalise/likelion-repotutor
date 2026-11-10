import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { ControlFlowNode, FunctionControlFlow } from "@/types/controlFlow";
import { buildControlGraph } from "./graphBuilder";
import { validateFunctionControlFlow } from "./validator";

function parse(body: string) {
  const source = `function a() {}\nfunction b() {}\nfunction cleanup() {}\nexport default async function Page(flag: boolean, other: boolean) {\n${body}\n}`;
  const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: source }], "cfg-test");
  const fn = analysis.files[0].functions.find(fn => fn.name === "Page")!;
  const cfg = analysis.functionControlFlows!.find(flow => flow.ownerFunctionId === fn.id)!;
  return { analysis, cfg, fn };
}
function statement(cfg: FunctionControlFlow, code: string) {
  const found = cfg.statements.find(item => item.sourceCode === code);
  expect(found, `missing statement: ${code}`).toBeDefined(); return found!;
}
function instance(cfg: FunctionControlFlow, code: string) {
  const item = statement(cfg, code);
  return cfg.nodes.filter(node => node.statementId === item.id);
}
function reaches(cfg: FunctionControlFlow, from: string, to: string, includePossible = false): boolean {
  const visited = new Set([from]), queue = [from];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const edge of cfg.edges.filter(edge => edge.source === queue[cursor] && (includePossible || edge.certainty === "structural"))) {
    if (!visited.has(edge.target)) { visited.add(edge.target); queue.push(edge.target); }
  }
  return visited.has(to);
}
function nodeFor(cfg: FunctionControlFlow, code: string): ControlFlowNode { return instance(cfg, code)[0]; }

describe("function-body static control flow", () => {
  it("links sequential statements without making inter-function ordering claims", () => {
    const { cfg, analysis } = parse("a();\nb();\nreturn 1;");
    expect(cfg.edges.some(edge => edge.source === nodeFor(cfg, "a();").id && edge.target === nodeFor(cfg, "b();").id && edge.kind === "next")).toBe(true);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.return)).toBe(true);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.normal)).toBe(false);
    expect(cfg.callSites.every(call => call.execution === "not-established")).toBe(true);
    expect(validateFunctionControlFlow(cfg, analysis)).toEqual({ valid: true, errors: [] });
  });

  it("builds both if/else paths and merges normal continuations", () => {
    const { cfg } = parse("if (flag) { a(); } else { b(); }\ncleanup();");
    const condition = cfg.statements.find(item => item.kind === "if")!;
    expect(condition.condition!.sourceCode).toBe("flag");
    expect(cfg.edges.filter(edge => edge.source === cfg.nodes.find(node => node.statementId === condition.id)!.id).map(edge => edge.kind)).toEqual(expect.arrayContaining(["true", "false"]));
    expect(reaches(cfg, nodeFor(cfg, "a();").id, nodeFor(cfg, "cleanup();").id)).toBe(true);
    expect(reaches(cfg, nodeFor(cfg, "b();").id, nodeFor(cfg, "cleanup();").id)).toBe(true);
    expect(statement(cfg, "a();").branchPath).toEqual([{ conditionStatementId: condition.id, branch: "true" }]);
    expect(statement(cfg, "b();").branchPath).toEqual([{ conditionStatementId: condition.id, branch: "false" }]);
  });

  it("preserves else-if and nested condition paths without evaluating predicates", () => {
    const { cfg } = parse("if (flag) { a(); } else if (other) { b(); } else { cleanup(); }");
    expect(cfg.statements.filter(item => item.kind === "if")).toHaveLength(2);
    expect(statement(cfg, "b();").branchPath.map(item => item.branch)).toEqual(["false", "true"]);
    expect(statement(cfg, "cleanup();").branchPath.map(item => item.branch)).toEqual(["false", "false"]);
    const nested = parse("if (flag) { if (other) { a(); } }").cfg;
    expect(statement(nested, "a();").branchPath.map(item => item.branch)).toEqual(["true", "true"]);
  });

  it("never connects a normal continuation after an early return", () => {
    const { cfg } = parse("a();\nreturn;\nb();");
    expect(statement(cfg, "b();").reachability).toBe("unreachable-in-model");
    expect(reaches(cfg, cfg.entryNodeId, nodeFor(cfg, "b();").id, true)).toBe(false);
    expect(cfg.edges.filter(edge => edge.source === nodeFor(cfg, "return;").id).every(edge => edge.kind === "return")).toBe(true);
  });

  it("connects code after a conditional return only through the other branch", () => {
    const { cfg } = parse("if (flag) return 1;\nb();");
    const returned = nodeFor(cfg, "return 1;");
    expect(reaches(cfg, returned.id, nodeFor(cfg, "b();").id, true)).toBe(false);
    expect(cfg.edges.some(edge => edge.target === nodeFor(cfg, "b();").id && edge.kind === "false")).toBe(true);
  });

  it("terminates throw without falling through", () => {
    const { cfg } = parse("throw 1;\na();");
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.throw)).toBe(true);
    expect(statement(cfg, "a();").reachability).toBe("unreachable-in-model");
    expect(reaches(cfg, nodeFor(cfg, "throw 1;").id, nodeFor(cfg, "a();").id, true)).toBe(false);
  });

  it("routes an explicit throw into catch and continues only after catch normal completion", () => {
    const { cfg } = parse("try { throw 1; } catch (error) { a(); }\nb();");
    const caught = cfg.statements.find(item => item.kind === "catch")!;
    const caughtNode = cfg.nodes.find(node => node.statementId === caught.id)!;
    expect(cfg.edges.some(edge => edge.source === nodeFor(cfg, "throw 1;").id && edge.target === caughtNode.id && edge.kind === "throw")).toBe(true);
    expect(reaches(cfg, caughtNode.id, nodeFor(cfg, "b();").id)).toBe(true);
  });

  it("marks possible expression/await failures as possible exceptions rather than observed throws", () => {
    const { cfg } = parse("try { await a(); } catch { b(); }");
    const awaited = nodeFor(cfg, "await a();");
    expect(cfg.edges.some(edge => edge.source === awaited.id && edge.kind === "exception" && edge.certainty === "possible" && edge.reason === "expression-may-throw")).toBe(true);
    expect(cfg.edges.some(edge => edge.source === awaited.id && edge.kind === "next")).toBe(true);
    expect(cfg.awaitSites[0].completionOrder).toBe("not-established");
  });

  it.each(["return 1;", "throw 1;"])("routes %s through finally without reaching a normal successor", abrupt => {
    const { cfg, analysis } = parse(`try { ${abrupt} } finally { cleanup(); }\nb();`);
    const completion = abrupt.startsWith("return") ? "return" : "throw";
    const source = nodeFor(cfg, abrupt);
    const final = instance(cfg, "cleanup();").find(node => node.context.at(-1)?.pendingCompletion === completion)!;
    expect(reaches(cfg, source.id, final.id)).toBe(true);
    expect(reaches(cfg, final.id, cfg.exits[completion])).toBe(true);
    expect(reaches(cfg, final.id, nodeFor(cfg, "b();").id, true)).toBe(false);
    expect(statement(cfg, "b();").reachability).toBe("unreachable-in-model");
    expect(validateFunctionControlFlow(cfg, analysis).valid).toBe(true);
  });

  it("routes normal completion through finally to the next statement", () => {
    const { cfg } = parse("try { const value = 1; } finally { cleanup(); }\nb();");
    const final = instance(cfg, "cleanup();").find(node => node.context.at(-1)?.pendingCompletion === "normal")!;
    expect(reaches(cfg, cfg.entryNodeId, final.id)).toBe(true);
    expect(reaches(cfg, final.id, nodeFor(cfg, "b();").id)).toBe(true);
  });

  it.each([["throw 1;", "return 2;", "return"], ["return 1;", "throw 2;", "throw"]] as const)("lets finally override %s with %s", (pending, overriding, exit) => {
    const { cfg } = parse(`try { ${pending} } finally { ${overriding} }`);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits[exit])).toBe(true);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits[exit === "return" ? "throw" : "return"])).toBe(false);
  });

  it("keeps normal/return/throw finally instances from mixing paths", () => {
    const { cfg } = parse("try { if (flag) return 1; a(); } finally { cleanup(); }\nb();");
    const instances = instance(cfg, "cleanup();");
    expect(new Set(instances.map(node => node.context.at(-1)!.pendingCompletion))).toEqual(new Set(["normal", "return", "throw"]));
    const after = nodeFor(cfg, "b();");
    for (const node of instances) expect(reaches(cfg, node.id, after.id, true)).toBe(node.context.at(-1)!.pendingCompletion === "normal");
  });

  it("propagates a return through nested finalizers in structural statement order", () => {
    const { cfg } = parse("try { try { return 1; } finally { a(); } } finally { b(); }");
    const inner = instance(cfg, "a();").find(node => node.context.at(-1)?.pendingCompletion === "return")!;
    const outer = instance(cfg, "b();").find(node => node.context.at(-1)?.pendingCompletion === "return")!;
    expect(reaches(cfg, nodeFor(cfg, "return 1;").id, inner.id)).toBe(true);
    expect(reaches(cfg, inner.id, outer.id)).toBe(true);
    expect(reaches(cfg, outer.id, cfg.exits.return)).toBe(true);
    expect(reaches(cfg, outer.id, inner.id)).toBe(false);
  });

  it("does not send throws from catch or finally back into the same catch", () => {
    const { cfg } = parse("try { throw 1; } catch { throw 2; } finally { throw 3; }");
    const caught = cfg.nodes.find(node => node.statementId === cfg.statements.find(item => item.kind === "catch")!.id)!;
    expect(reaches(cfg, nodeFor(cfg, "throw 2;").id, caught.id, true)).toBe(false);
    expect(reaches(cfg, instance(cfg, "throw 3;")[0].id, caught.id, true)).toBe(false);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.throw)).toBe(true);
  });

  it("supports conditional abrupt completion inside finally without choosing its branch", () => {
    const { cfg } = parse("try { throw 1; } finally { if (flag) return 2; cleanup(); }");
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.return)).toBe(true);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.throw)).toBe(true);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.normal)).toBe(false);
  });

  it("records statement/call/await positions and lexical branch evidence", () => {
    const { cfg, analysis } = parse("if (flag) {\n const value = await a();\n b();\n}");
    const call = cfg.callSites.find(site => site.sourceCode === "a()")!;
    expect(call.branchPath.map(item => item.branch)).toEqual(["true"]);
    expect(call.targetNodeId).toBe(analysis.files[0].functions.find(fn => fn.name === "a")!.id);
    expect(call.sourceEdgeIds).toHaveLength(1);
    expect(cfg.awaitSites).toHaveLength(1);
    expect(cfg.awaitSites[0].sourceCode).toBe("await a()");
    expect(cfg.awaitSites[0].branchPath).toEqual(call.branchPath);
    for (const item of [...cfg.statements, ...cfg.callSites, ...cfg.awaitSites]) expect(analysis.files[0].sourceCode.slice(item.location.startOffset, item.location.endOffset)).toBe(item.sourceCode);
  });

  it.each(["for (;;) { a(); }", "while (flag) { a(); }", "do { a(); } while (flag);", "for (const x of []) { a(); }", "switch (flag) { default: a(); }"])("treats unsupported syntax as an opaque boundary: %s", code => {
    const { cfg } = parse(`${code}\nb();`);
    expect(cfg.status).toBe("partial");
    expect(cfg.statements.some(item => item.kind === "unsupported")).toBe(true);
    expect(statement(cfg, "b();").reachability).toBe("unknown");
    expect(reaches(cfg, cfg.entryNodeId, nodeFor(cfg, "b();").id, true)).toBe(false);
    expect(cfg.callSites.find(site => site.sourceCode === "a()")!.inUnsupportedRegion).toBe(true);
  });

  it.each(["flag ? a() : b();", "flag && a();", "object?.method();"])("does not invent internal expression paths for %s", code => {
    const { cfg } = parse(`${code}\ncleanup();`);
    expect(cfg.status).toBe("partial");
    expect(statement(cfg, code).kind).toBe("unsupported");
    expect(reaches(cfg, cfg.entryNodeId, nodeFor(cfg, "cleanup();").id, true)).toBe(false);
  });

  it("does not force an opaque non-terminating try body through finally", () => {
    const { cfg } = parse("try { while (flag) { a(); } } finally { cleanup(); }\nb();");
    expect(statement(cfg, "cleanup();").reachability).toBe("unknown");
    expect(reaches(cfg, cfg.entryNodeId, nodeFor(cfg, "cleanup();").id, true)).toBe(false);
    expect(reaches(cfg, cfg.entryNodeId, cfg.exits.unknown)).toBe(true);
  });

  it("returns a normal entry/exit graph for an empty function", () => {
    const { cfg } = parse("");
    expect(cfg.statements).toEqual([]);
    expect(cfg.status).toBe("supported");
    expect(cfg.edges).toHaveLength(1);
    expect(cfg.edges[0]).toMatchObject({ source: cfg.entryNodeId, target: cfg.exits.normal, kind: "next" });
  });

  it("keeps nested callback bodies and expression-body returns in their own function", () => {
    const { cfg, analysis } = parse("const callback = () => a();\ncallback();");
    expect(cfg.callSites.map(site => site.sourceCode)).toEqual(["callback()"]);
    const nested = analysis.functionControlFlows!.find(flow => flow.ownerFunctionId === analysis.files[0].functions.find(fn => fn.name === "callback")!.id)!;
    expect(nested.statements[0]).toMatchObject({ kind: "return", implicitReturn: true, sourceCode: "a()" });
    expect(nested.callSites.map(site => site.sourceCode)).toEqual(["a()"]);
  });

  it("preserves distinct same-line call positions without inventing old edge IDs", () => {
    const { cfg } = parse("a(); a();");
    expect(cfg.callSites).toHaveLength(2);
    expect(new Set(cfg.callSites.map(site => site.id)).size).toBe(2);
    expect(new Set(cfg.callSites.flatMap(site => site.sourceEdgeIds)).size).toBe(1);
  });

  it("bounds extraction and CFG expansion without inventing a continuation", () => {
    const { cfg } = parse(Array.from({ length: 505 }, () => ";").join("\n"));
    expect(cfg.status).toBe("partial");
    expect(cfg.statements.length).toBeLessThanOrEqual(501);
    const bounded = structuredClone(parse("a(); b(); return 1;").cfg);
    buildControlGraph(bounded, { nodes: 6, edges: 1 });
    expect(bounded.nodes.length).toBeLessThanOrEqual(6);
    expect(bounded.edges.length).toBeLessThanOrEqual(1);
    expect(bounded.status).toBe("partial");
  });

  it("rejects changed statements, forged runtime claims and CFG edges", () => {
    const { cfg, analysis } = parse("if (flag) return 1;\na();");
    for (const changed of ["source", "edge", "owner", "runtime"] as const) {
      const forged = structuredClone(cfg);
      if (changed === "source") forged.statements[0].sourceCode = "invented()";
      if (changed === "edge") forged.edges[0].target = "invented";
      if (changed === "owner") forged.ownerFunctionId = "invented";
      if (changed === "runtime") Object.assign(forged, { runtimeExecution: "observed" });
      expect(validateFunctionControlFlow(forged, analysis).valid).toBe(false);
    }
  });
});
