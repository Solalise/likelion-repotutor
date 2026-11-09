import { describe, expect, it } from "vitest";
import type { FunctionInfo, RepositoryAnalysis } from "@/types/analysis";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "@/lib/features/featureDiscovery";
import { traceDisplayGraph } from "@/lib/graph/dfs";
import { buildLearningContext } from "@/lib/ai/learningContext";
import { buildLearningPrompt } from "@/lib/ai/learningExplanation";
import { buildLearningGraph, buildRepositoryLearningGraph } from "@/lib/learning/learningGraphBuilder";
import { loadLocalRepository } from "@/lib/repository/loadLocalRepository";
import { analyzeSourceFiles } from "./analyzer";

const functions = (analysis: RepositoryAnalysis) => analysis.files.flatMap((file) => file.functions);
function fn(analysis: RepositoryAnalysis, name: string, parentId?: string): FunctionInfo {
  const matches = functions(analysis).filter((item) => item.name === name && (!parentId || item.parentId === parentId));
  expect(matches).toHaveLength(1);
  return matches[0];
}
const symbolEdges = (analysis: RepositoryAnalysis) => analysis.edges.filter((edge) => edge.relation !== "import");

describe("AST declaration identity and execution boundaries", () => {
  it("distinguishes identically named handlers in different components and reuses each target ID", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: `
      export function APage() { const handle = () => 'A'; return <button onClick={handle} onFocus={handle}/>; }
      export function BPage() { const handle = () => 'B'; return <button onClick={handle}/>; }
    ` }]);
    const a = fn(analysis, "APage"), b = fn(analysis, "BPage");
    const handleA = fn(analysis, "handle", a.id), handleB = fn(analysis, "handle", b.id);
    expect(handleA.id).not.toBe(handleB.id);
    expect(handleA.sourceCode).toContain("'A'");
    expect(handleB.sourceCode).toContain("'B'");
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: a.id, target: handleA.id, relation: "reference" }),
      expect.objectContaining({ source: b.id, target: handleB.id, relation: "reference" }),
    ]);
    expect(a.relations?.filter((relation) => relation.relation === "reference").map((relation) => relation.targetId)).toEqual([handleA.id]);
    expect(new Set(functions(analysis).map((item) => item.id)).size).toBe(4);
  });

  it("distinguishes declarations in sibling block scopes on the same line", () => {
    const analysis = analyzeSourceFiles([{ path: "scope.ts", content: "export function outer() { { const same = () => 1; same(); } { const same = () => 2; same(); } }" }]);
    const outer = fn(analysis, "outer");
    const siblings = functions(analysis).filter((item) => item.name === "same");
    expect(siblings).toHaveLength(2);
    expect(siblings[0].line).toBe(siblings[1].line);
    expect(siblings[0].id).not.toBe(siblings[1].id);
    expect(symbolEdges(analysis)).toEqual(siblings.map((item) => expect.objectContaining({ source: outer.id, target: item.id, relation: "call" })));
  });

  it("keeps inline callback calls on the callback, without asserting its execution by the recipient", () => {
    const analysis = analyzeSourceFiles([{ path: "callbacks.ts", content: `
      export function main() { run(() => work()); }
      function run(cb: () => void) { cb(); }
      function work() { return true; }
    ` }]);
    const main = fn(analysis, "main"), run = fn(analysis, "run"), work = fn(analysis, "work");
    const callback = functions(analysis).find((item) => item.name.startsWith("callback@"))!;
    expect(callback.parentId).toBe(main.id);
    expect(callback.sourceCode).toBe("() => work()");
    expect(symbolEdges(analysis)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: main.id, target: run.id, relation: "call" }),
      expect.objectContaining({ source: main.id, target: callback.id, relation: "reference" }),
      expect.objectContaining({ source: callback.id, target: work.id, relation: "call" }),
    ]));
    expect(symbolEdges(analysis)).toHaveLength(3);
    expect(run.relations).toContainEqual(expect.objectContaining({ name: "cb", targetId: undefined, confidence: "inferred" }));
    expect(symbolEdges(analysis).some((edge) => edge.source === main.id && edge.target === work.id)).toBe(false);
    expect(symbolEdges(analysis).some((edge) => edge.source === run.id)).toBe(false);
  });

  it("separates nested anonymous callbacks, function expressions and JSX event callbacks", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: `
      export function Page() {
        run(function () { run(() => work()); });
        return <button onClick={() => work()}/>;
      }
      function work() { return true; }
    ` }]);
    const page = fn(analysis, "Page"), work = fn(analysis, "work");
    const callbacks = functions(analysis).filter((item) => item.name.startsWith("callback@"));
    expect(callbacks).toHaveLength(3);
    expect(new Set(callbacks.map((item) => item.id)).size).toBe(3);
    expect(symbolEdges(analysis).filter((edge) => edge.target === work.id).every((edge) => callbacks.some((item) => item.id === edge.source))).toBe(true);
    expect(symbolEdges(analysis).filter((edge) => edge.source === page.id).every((edge) => edge.relation === "reference")).toBe(true);
    expect(symbolEdges(analysis).filter((edge) => edge.relation === "reference")).toHaveLength(3);
  });

  it("does not confuse a render-time factory call with a callback reference", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: "export function Page() { return <button onClick={makeHandler()}/>; } function makeHandler() { return () => true; }" }]);
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: fn(analysis, "Page").id, target: fn(analysis, "makeHandler").id, relation: "call" }),
    ]);
  });

  it.each(["useMemo", "useCallback"])("does not identify a %s wrapper result as its callback", (wrapper) => {
    const analysis = analyzeSourceFiles([{ path: "wrapper.ts", content: `
      export function main() { const result = ${wrapper}(() => work(), []); result(); }
      function ${wrapper}(cb: () => unknown, deps: unknown[]) { return () => true; }
      function work() { return 123; }
    ` }]);
    const main = fn(analysis, "main"), callback = fn(analysis, "result.callback"), work = fn(analysis, "work");
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: main.id, target: fn(analysis, wrapper).id, relation: "call" }),
      expect.objectContaining({ source: main.id, target: callback.id, relation: "reference" }),
      expect.objectContaining({ source: callback.id, target: work.id, relation: "call" }),
    ]);
    expect(main.relations).toContainEqual(expect.objectContaining({ name: "result", targetId: undefined, confidence: "inferred" }));
  });

  it("recognizes function-valued JSX props without treating callback bodies as render-time calls", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: "export function Page() { return <List renderItem={() => work()}/>; } function work() {}" }]);
    const callback = functions(analysis).find((item) => item.name.startsWith("callback@"))!;
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: fn(analysis, "Page").id, target: callback.id, relation: "reference" }),
      expect.objectContaining({ source: callback.id, target: fn(analysis, "work").id, relation: "call" }),
    ]);
  });

  it("records an immediately invoked function as a call rather than a callback reference", () => {
    const analysis = analyzeSourceFiles([{ path: "iife.ts", content: "export function main() { (() => work())(); } function work() {}" }]);
    const main = fn(analysis, "main"), work = fn(analysis, "work");
    const callback = functions(analysis).find((item) => item.name.startsWith("callback@"))!;
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: main.id, target: callback.id, relation: "call" }),
      expect.objectContaining({ source: callback.id, target: work.id, relation: "call" }),
    ]);
  });

  it("keeps repeated references on different lines connected to the same declaration", () => {
    const analysis = analyzeSourceFiles([{ path: "references.ts", content: `
      function callback() {}
      export function main() {
        first(callback);
        second(callback);
        callback();
      }
    ` }]);
    const callback = fn(analysis, "callback"), main = fn(analysis, "main");
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: main.id, target: callback.id, relation: "reference", line: 4 }),
      expect.objectContaining({ source: main.id, target: callback.id, relation: "reference", line: 5 }),
      expect.objectContaining({ source: main.id, target: callback.id, relation: "call", line: 6 }),
    ]);
  });

  it("does not connect an unused nested declaration or include it in the selected feature flow", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: "export default function OuterPage() { function inner() { return true; } return <div/>; }" }]);
    const outer = fn(analysis, "OuterPage"), inner = fn(analysis, "inner");
    expect(inner.parentId).toBe(outer.id);
    expect(symbolEdges(analysis)).toEqual([]);
    const discovery = discoverRepositoryFeatures(analysis);
    const feature = discovery.limited.find((item) => item.entryNodeId === outer.id)!;
    expect(feature.nodeIds).toEqual([outer.id]);
    expect(traverseRepositoryFeature(analysis, feature, 5).nodes.map((node) => node.id)).toEqual([outer.id]);
    expect(buildRepositoryLearningGraph(analysis, feature.nodeIds).nodes.map((node) => node.id)).toEqual([outer.id]);
    expect(buildLearningContext(analysis, { type: "function", functionId: outer.id }).candidateCodeCount).toBe(1);
  });

  it("records a nested call without inventing a declaration reference", () => {
    const analysis = analyzeSourceFiles([{ path: "nested.ts", content: "export function outer() { function inner() { return true; } return inner(); }" }]);
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: fn(analysis, "outer").id, target: fn(analysis, "inner").id, relation: "call", evidence: "inner()" }),
    ]);
  });

  it("records passing a named function separately from its internal calls", () => {
    const analysis = analyzeSourceFiles([{ path: "named.ts", content: "export function outer() { function inner() { return work(); } external(inner); } function work() {}" }]);
    const outer = fn(analysis, "outer"), inner = fn(analysis, "inner"), work = fn(analysis, "work");
    expect(symbolEdges(analysis)).toEqual([
      expect.objectContaining({ source: outer.id, target: inner.id, relation: "reference" }),
      expect.objectContaining({ source: inner.id, target: work.id, relation: "call" }),
    ]);
  });

  it("does not guess targets for shadowing parameters, local values or missing imports", () => {
    const analysis = analyzeSourceFiles([{ path: "shadow.ts", content: `
      import { missing } from './absent';
      function work() { return true; }
      export function shadow(work: () => void) { work(); }
      export function local() { const work = externalValue; work(); }
      export function unresolved() { missing(); }
      function container() { const notAFunction = 1; external(notAFunction); }
    ` }]);
    expect(symbolEdges(analysis)).toEqual([]);
    expect(fn(analysis, "shadow").relations).toContainEqual(expect.objectContaining({ name: "work", targetId: undefined }));
  });

  it("connects callers across named/default/namespace imports, re-exports and const aliases to one declaration", () => {
    const inputs = [
      { path: "lib/work.ts", content: "export default function work() { return true; } export { work };" },
      { path: "lib/index.ts", content: "export { default as execute } from './work';" },
      { path: "a.ts", content: "import work from './lib/work'; export function a() { work(); work(); }" },
      { path: "b.ts", content: "import { execute as renamed } from './lib'; export function b() { const alias = renamed; alias(); }" },
      { path: "c.ts", content: "import * as actions from './lib/work'; export function c() { actions.work(); }" },
    ];
    const analysis = analyzeSourceFiles(inputs);
    const work = fn(analysis, "work");
    const calls = symbolEdges(analysis);
    expect(calls).toHaveLength(3);
    expect(calls.every((edge) => edge.target === work.id && edge.relation === "call")).toBe(true);
    expect(calls.map((edge) => edge.source)).toEqual(["a", "b", "c"].map((name) => fn(analysis, name).id));
    expect(functions(analyzeSourceFiles([...inputs].reverse())).map((item) => item.id).sort()).toEqual(functions(analysis).map((item) => item.id).sort());
    expect(fn(analyzeSourceFiles(inputs), "work").id).toBe(work.id);
  });

  it("uses implementations for overloads and preserves explicit recursion", () => {
    const analysis = analyzeSourceFiles([{ path: "overloads.ts", content: `
      export function repeat(value: number): number;
      export function repeat(value: string): string;
      export function repeat(value: number | string): number | string { return repeat(value); }
      export function main() { return repeat(1); }
    ` }]);
    const repeat = fn(analysis, "repeat");
    expect(repeat.sourceCode).toContain("return repeat(value)");
    expect(symbolEdges(analysis)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: repeat.id, target: repeat.id, relation: "call" }),
      expect.objectContaining({ source: fn(analysis, "main").id, target: repeat.id, relation: "call" }),
    ]));
  });

  it("distinguishes class methods, function fields and object methods by declaration", () => {
    const analysis = analyzeSourceFiles([{ path: "methods.ts", content: `
      class A { run() { return 1; } field = () => this.run(); }
      class B { run() { return 2; } }
      const one = { run() { return 3; } }; const two = { run() { return 4; } };
      export function main() { new A().run(); new A().field(); new B().run(); one.run(); two.run(); }
    ` }]);
    const main = fn(analysis, "main");
    for (const name of ["A.run", "A.field", "B.run", "one.run", "two.run"]) {
      expect(symbolEdges(analysis)).toContainEqual(expect.objectContaining({ source: main.id, target: fn(analysis, name).id, relation: "call" }));
    }
    expect(symbolEdges(analysis)).toContainEqual(expect.objectContaining({ source: fn(analysis, "A.field").id, target: fn(analysis, "A.run").id, relation: "call" }));
  });

  it("propagates scoped IDs through feature discovery, bounded traversal, learning graphs and AI context", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/a/page.tsx", content: `
        import { workA } from '../../work';
        export default function APage() { const handle = () => workA(); return <button onClick={handle}/>; }
      ` },
      { path: "app/b/page.tsx", content: `
        import { workB } from '../../work';
        export default function BPage() { const handle = () => workB(); return <button onClick={handle}/>; }
      ` },
      { path: "work.ts", content: "export function workA() { return 'A'; } export function workB() { return 'B'; }" },
    ]);
    const a = fn(analysis, "APage"), b = fn(analysis, "BPage"), handle = fn(analysis, "handle", a.id), work = fn(analysis, "workA");
    const feature = discoverRepositoryFeatures(analysis).primary.find((item) => item.entryNodeId === a.id)!;
    expect(feature.nodeIds).toEqual(expect.arrayContaining([a.id, handle.id, work.id]));
    expect(feature.nodeIds).not.toContain(fn(analysis, "handle", b.id).id);
    const shallow = traverseRepositoryFeature(analysis, feature, 1);
    expect(shallow.nodes.map((item) => item.id)).toEqual([a.id, handle.id]);
    const expanded = traceDisplayGraph(a.id, analysis.nodes, analysis.edges, { maxDepth: 3, expandedNodeIds: [handle.id] });
    expect(expanded.nodes.map((item) => item.id)).toEqual(expect.arrayContaining([a.id, handle.id, work.id]));
    expect(buildRepositoryLearningGraph(analysis, feature.nodeIds).nodes.map((item) => item.id)).toEqual(expect.arrayContaining([a.id, handle.id, work.id]));
    const context = buildLearningContext(analysis, { type: "function", functionId: handle.id });
    expect(context.code[0]).toMatchObject({ functionId: handle.id, sourceCode: handle.sourceCode });
    expect(context.code[0].relations).toContainEqual(expect.objectContaining({ otherFunctionId: work.id, relation: "call" }));
    expect(buildLearningPrompt(context)).toContain(handle.id);
    const featureContext = buildLearningContext(analysis, { type: "feature", feature });
    expect(featureContext.selection.id).toBe(feature.id);
    expect(featureContext.code[0].functionId).toBe(a.id);
    expect(featureContext.code.some((item) => item.functionId === fn(analysis, "workB").id)).toBe(false);
  });

  it("keeps the explicit sample demo working with scoped IDs and additional anonymous functions", async () => {
    const sources = await loadLocalRepository(`${process.cwd()}/sample-repository`);
    const analysis: RepositoryAnalysis = { ...analyzeSourceFiles(sources), source: "sample" };
    const graph = buildLearningGraph(analysis);
    expect(graph.nodes).toHaveLength(8);
    expect(graph.nodes.every((item) => item.source === "demo")).toBe(true);
    for (const name of ["LoginPage", "handleLogin", "login", "POST", "findUser"]) {
      expect(graph.nodes.find((item) => item.technicalName === name)?.id).toBe(fn(analysis, name).id);
    }
    expect(graph.edges).toHaveLength(7);
  });
});
