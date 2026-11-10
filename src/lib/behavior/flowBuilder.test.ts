import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { discoverRepositoryFeatures } from "@/lib/features/featureDiscovery";
import type { RepositoryAnalysis, RepositoryEntryPoint, SourceInput } from "@/types/analysis";
import { buildBehaviorFlow as projectFlow, buildBehaviorFlows as projectFlows } from "./flowBuilder";

// Preserve stage-1 projection assertions while event-enabled behavior has dedicated tests.
const buildBehaviorFlow: typeof projectFlow = (analysis, entry, options) => projectFlow(analysis, entry, { ...options, includeEvents: false });
const buildBehaviorFlows: typeof projectFlows = (analysis, options) => projectFlows(analysis, { ...options, includeEvents: false });
import { validateBehaviorFlow } from "./flowValidator";
import { nextLoginSources } from "./fixtures/nextLogin";

const example = analyzeSourceFiles(nextLoginSources, "behavior-example");
function entry(analysis: RepositoryAnalysis, route = "/login", method?: string): RepositoryEntryPoint {
  return analysis.entryPoints!.find(item => item.routePath === route && item.method === method)!;
}
function fixture(sources: SourceInput[], route = "/"): ReturnType<typeof buildBehaviorFlow> {
  const analysis = analyzeSourceFiles(sources);
  return buildBehaviorFlow(analysis, entry(analysis, route));
}
function freeze(value: unknown) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(freeze);
  }
}

describe("evidence based behavior projection", () => {
  it("follows page -> reference -> handler -> confirmed call -> matched API without claiming order", () => {
    const flow = buildBehaviorFlow(example, entry(example));
    expect(flow.status).toBe("partial");
    expect(flow.nodes.map(node => node.label).sort()).toEqual(["LoginPage", "POST", "POST /api/login", "onSubmit", "submit"].sort());
    expect(flow.edges.map(edge => edge.relation).sort()).toEqual(["reference", "call", "api-request", "api-route"].sort());
    expect(flow.nodes.filter(node => node.kind === "api-request").map(node => node.request)).toEqual([{ path: "/api/login", method: "POST" }]);
    expect(flow.nodes.map(node => node.kind).sort()).toEqual(["screen", "function", "function", "api-request", "server"].sort());
    expect(flow.edges.every(edge => edge.confidence === "confirmed" && edge.semantics === "static-relation" && edge.executionOrder === "not-established")).toBe(true);
    expect(validateBehaviorFlow(flow, example)).toEqual({ valid: true, errors: [] });
    const reference = flow.edges.find(edge => edge.relation === "reference")!;
    const evidence = flow.evidence.find(item => reference.evidenceIds.includes(item.id))!;
    expect(evidence.location).toEqual({ filePath: "app/login/page.tsx", precision: "line", startLine: 4, endLine: 4 });
    expect(evidence.excerpt).toContain("onClick={onSubmit}");
  });

  it("keeps other pages and the API's internal implementation out of the page flow", () => {
    const page = buildBehaviorFlow(example, entry(example));
    expect(page.nodes.map(node => node.label)).not.toContain("SettingsPage");
    expect(page.nodes.map(node => node.label)).not.toContain("save");
    expect(page.limitations.some(item => item.code === "entry-boundary")).toBe(true);
    const api = buildBehaviorFlow(example, entry(example, "/api/login", "POST"));
    expect(api.nodes.map(node => node.label).sort()).toEqual(["POST", "save"]);
    expect(api.nodes.find(node => node.label === "save")?.kind).toBe("function");
  });

  it("does not turn call ordering, condition text, DB-looking names, or responses into stages", () => {
    const flow = fixture([
      { path: "app/page.tsx", content: "import { login, save } from '../lib/db'; export default function Page() { if (Math.random()) login(); save(); return <div/>; }" },
      { path: "lib/db.ts", content: "export function login() { return 1; } export function save() { return 2; }" },
    ]);
    expect(flow.nodes.map(node => node.label).sort()).toEqual(["Page", "login", "save"]);
    expect(flow.nodes.every(node => ["screen", "function"].includes(node.kind))).toBe(true);
    const labels = new Map(flow.nodes.map(node => [node.id, node.label]));
    expect(flow.edges.map(edge => [labels.get(edge.source), labels.get(edge.target)])).toEqual(expect.arrayContaining([["Page", "login"], ["Page", "save"]]));
    expect(flow.edges.some(edge => labels.get(edge.source) === "login" && labels.get(edge.target) === "save")).toBe(false);
  });

  it.each([
    'fetch(url)', 'fetch(`/api/${id}`)', 'fetch("/api/missing")', 'fetch("/api/login", options)',
    'fetch("https://example.com/api/login")', 'fetch("/api/login", { method: "DELETE" })',
  ])("retains an unresolved API request without guessing an endpoint: %s", (expression) => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: `export default function Page() { ${expression}; return <div/>; }` },
      nextLoginSources.find(source => source.path === "app/api/login/route.ts")!,
      nextLoginSources.find(source => source.path === "lib/storage.ts")!,
    ]);
    const flow = buildBehaviorFlow(analysis, entry(analysis, "/"));
    expect(flow.nodes.map(node => node.label)).toEqual(["Page"]);
    expect(flow.edges).toEqual([]);
    expect(flow.unresolved.some(item => item.relation === "api" && item.reason === "inferred-relation")).toBe(true);
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(true);
  });

  it("does not connect a local function named fetch to an API route", () => {
    const flow = fixture([
      { path: "app/page.tsx", content: 'function fetch(url: string) { return url; } export default function Page() { fetch("/api/login"); return <div/>; }' },
      nextLoginSources[2], nextLoginSources[3],
    ]);
    expect(flow.nodes.some(node => node.kind === "api-request")).toBe(false);
    expect(flow.edges.map(edge => edge.relation)).toEqual(["call"]);
  });

  it("retains callback/component references as references, not events or invocations", () => {
    const flow = fixture([{ path: "app/page.tsx", content: `
      function Child({ action }: {action: () => void}) { return <button onClick={action}/>; }
      function handler() { return 1; }
      export default function Page() { return <Child action={handler}/>; }
    ` }]);
    expect(flow.edges.map(edge => edge.relation).sort()).toEqual(["component", "reference"]);
    expect(flow.nodes.some(node => node.kind === "event")).toBe(false);
    expect(flow.limitations.some(item => item.code === "event-semantics-unavailable")).toBe(true);
  });

  it("stops at other page entrypoints even when there is a direct confirmed call", () => {
    const flow = fixture([
      { path: "app/page.tsx", content: 'import Other from "./other/page"; export default function Page() { return Other(); }' },
      { path: "app/other/page.tsx", content: "export default function Other() { return <div/>; }" },
    ]);
    expect(flow.nodes.map(node => node.label)).toEqual(["Page"]);
    expect(flow.unresolved.some(item => item.reason === "entry-boundary")).toBe(true);
  });

  it("handles cycles and aggregates repeated call sites without losing their locations", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: [
      "function a() { b(); b(); }", "function b() { a(); }", "export default function Page() { a(); return <div/>; }",
    ].join("\n") }]);
    const flow = buildBehaviorFlow(analysis, entry(analysis, "/"));
    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges).toHaveLength(3);
    expect(new Set(flow.edges.map(edge => edge.id)).size).toBe(3);
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(true);
    const separate = analyzeSourceFiles([{ path: "app/page.tsx", content: "function x() {}\nexport default function Page() {\n x();\n x();\n return <div/>;\n}" }]);
    const repeated = buildBehaviorFlow(separate, entry(separate, "/"));
    expect(repeated.edges).toHaveLength(1);
    expect(repeated.edges[0].sourceEdgeIds).toHaveLength(2);
    expect(repeated.edges[0].evidenceIds).toHaveLength(2);
  });

  it("deduplicates identical AST records and is deterministic", () => {
    const duplicate = structuredClone(example);
    duplicate.edges.push(...structuredClone(example.edges));
    duplicate.entryPoints!.push(...structuredClone(example.entryPoints!));
    expect(buildBehaviorFlows(duplicate)).toEqual(buildBehaviorFlows(example));
    const reversed = structuredClone(example);
    reversed.edges.reverse(); reversed.nodes.reverse(); reversed.files.reverse(); reversed.entryPoints!.reverse();
    expect(buildBehaviorFlows(reversed)).toEqual(buildBehaviorFlows(example));
  });

  it("does not mutate even a recursively frozen input or a RepositoryFeature", () => {
    const input = structuredClone(example);
    const features = discoverRepositoryFeatures(input);
    const before = JSON.stringify({ input, features });
    freeze(input); freeze(features);
    buildBehaviorFlows(input);
    expect(JSON.stringify({ input, features })).toBe(before);
  });

  it("does not upgrade inferred/missing confidence or invent a graph edge from a name", () => {
    for (const confidence of ["inferred", undefined] as const) {
      const input = structuredClone(example);
      input.edges.forEach(edge => { if (edge.relation === "call") edge.confidence = confidence; });
      const flow = buildBehaviorFlow(input, entry(input));
      expect(flow.edges.some(edge => edge.relation === "call")).toBe(false);
      expect(flow.nodes.map(node => node.label)).not.toContain("submit");
      expect(flow.unresolved.some(item => item.reason === "evidence-unavailable")).toBe(true);
    }
  });

  it("does not connect a graph edge whose source location disagrees with the AST relation", () => {
    const input = structuredClone(example);
    input.edges.forEach(edge => { if (edge.relation === "call") edge.line = 9999; });
    const flow = buildBehaviorFlow(input, entry(input));
    expect(flow.edges.some(edge => edge.relation === "call")).toBe(false);
  });

  it.each([{ maxDepth: 0 }, { maxNodes: 1 }, { maxEdges: 0 }])("reports traversal budgets without dangling nodes or evidence", (options) => {
    const flow = buildBehaviorFlow(example, entry(example), options);
    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toEqual([]);
    expect(flow.limitations.some(item => item.code === "traversal-limit")).toBe(true);
    expect(validateBehaviorFlow(flow, example).valid).toBe(true);
  });

  it("returns limitations rather than inventing entries in unsupported repositories", () => {
    for (const sources of [[], [{ path: "server.py", content: "def login(): pass" }], [{ path: "lib/login.ts", content: "export function LoginPage() {}" }]]) {
      const result = buildBehaviorFlows(analyzeSourceFiles(sources));
      expect(result.flows).toEqual([]);
      expect(result.limitations.some(item => item.code === "entry-point-unavailable")).toBe(true);
    }
  });

  it("returns unavailable for an unregistered entry or missing declaration evidence", () => {
    expect(buildBehaviorFlow(example, { ...entry(example), routePath: "/fake" }).status).toBe("unavailable");
    const input = structuredClone(example);
    input.nodes.find(node => node.id === entry(input).nodeId)!.line = 999;
    const flow = buildBehaviorFlow(input, entry(input));
    expect(flow.status).toBe("unavailable");
    expect(flow.nodes).toEqual([]);
  });

  it("maps re-export entry files separately without inventing an export line", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: 'export { Screen as default } from "../screens/Screen";' },
      { path: "screens/Screen.tsx", content: "export function Screen() { return <div/>; }" },
    ]);
    const flow = buildBehaviorFlow(analysis, entry(analysis, "/"));
    expect(flow.status).toBe("partial");
    expect(flow.evidence.find(item => item.origin.kind === "entry-point")!.location).toEqual({ filePath: "app/page.tsx", precision: "file" });
    expect(flow.evidence.find(item => item.origin.kind === "declaration")!.location.filePath).toBe("screens/Screen.tsx");
  });

  it("preserves multiple API exports sharing a handler without losing method provenance", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: 'export default function Page() {\n fetch("/api/shared");\n fetch("/api/shared", { method: "POST" });\n return <div/>;\n}' },
      { path: "app/api/shared/route.ts", content: 'export { handler as GET, handler as POST } from "../../../lib/handler";' },
      { path: "lib/handler.ts", content: "export function handler() { return 1; }" },
    ]);
    const flow = buildBehaviorFlow(analysis, entry(analysis, "/"));
    expect(flow.status).toBe("partial");
    expect(flow.nodes.filter(node => node.kind === "api-request")).toHaveLength(2);
    expect(flow.nodes.filter(node => node.kind === "server")).toHaveLength(1);
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(true);
  });

  it("does not recreate an API edge lost by the existing same-line graph deduplication", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/page.tsx", content: 'export default function Page() { fetch("/api/shared"); fetch("/api/shared", { method: "POST" }); return <div/>; }' },
      { path: "app/api/shared/route.ts", content: 'export { handler as GET, handler as POST } from "../../../lib/handler";' },
      { path: "lib/handler.ts", content: "export function handler() { return 1; }" },
    ]);
    expect(analysis.files[0].functions[0].relations!.filter(item => item.relation === "api")).toHaveLength(2);
    expect(analysis.edges.filter(edge => edge.relation === "api")).toHaveLength(1);
    const flow = buildBehaviorFlow(analysis, entry(analysis, "/"));
    expect(flow.nodes.filter(node => node.kind === "api-request")).toHaveLength(1);
    expect(flow.unresolved.some(item => item.relation === "api" && item.reason === "evidence-unavailable")).toBe(true);
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(true);
  });

  it("preserves partial-collection and missing-version limitations", () => {
    const input = structuredClone(example);
    input.collection = { source: "github", discoveredFiles: 10, collectedFiles: 5, totalBytes: 100, durationMs: 1, partial: true, commitSha: "abc" };
    const flow = buildBehaviorFlow(input, entry(input));
    expect(flow.commitSha).toBe("abc");
    expect(flow.limitations.some(item => item.code === "partial-source")).toBe(true);
    expect(flow.limitations.some(item => item.code === "unversioned-source")).toBe(false);
  });

  it("uses real RepoTutor sources without network, DB, or changes to existing analysis", async () => {
    const paths = ["src/app/repository/page.tsx", "src/components/repository/RepositoryWorkspace.tsx", "src/app/api/repositories/[connectionId]/analyze/route.ts", "src/lib/github/repositoryAccess.ts"];
    const sources = await Promise.all(paths.map(async filePath => ({ path: filePath, content: await readFile(path.join(process.cwd(), filePath), "utf8") })));
    const analysis = analyzeSourceFiles(sources, "RepoTutor-local-subset");
    const before = JSON.stringify(analysis);
    const result = buildBehaviorFlows(analysis);
    expect(result.flows.length).toBeGreaterThanOrEqual(2);
    expect(result.flows.every(flow => flow.status === "partial" && validateBehaviorFlow(flow, analysis).valid)).toBe(true);
    expect(result.flows.some(flow => flow.nodes.some(node => node.label === "requireRepositoryAccess"))).toBe(true);
    expect(JSON.stringify(analysis)).toBe(before);
  });
});
