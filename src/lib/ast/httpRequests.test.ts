import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import { buildBehaviorFlows } from "@/lib/behavior/flowBuilder";
import { validateBehaviorFlow } from "@/lib/behavior/flowValidator";
import type { SourceInput } from "@/types/analysis";
import { readFileSync } from "node:fs";

function analyze(body: string, routes: SourceInput[] = [{ path: "app/api/users/route.ts", content: "export function GET() {} export function POST() {}" }], extra: SourceInput[] = []) {
  return analyzeSourceFiles([
    { path: "app/page.tsx", content: `export default async function Page() { ${body} }` }, ...routes, ...extra,
  ]);
}
const request = (body: string) => analyze(body).httpRequests![0];

describe("source-backed HTTP request boundaries", () => {
  it("matches POST with exact source span, owner, method and URL", () => {
    const analysis = analyze('await fetch("/api/users", {method:"POST"});');
    const site = analysis.httpRequests![0];
    expect(site.status).toBe("matched");
    expect(site.target?.entryPoint.method).toBe("POST");
    expect(analysis.files[0].sourceCode.slice(site.location.startOffset, site.location.endOffset)).toBe(site.sourceCode);
    expect(site.context?.callSiteId).toBeTruthy();
    expect(site.ownerFunctionId).toBe(analysis.entryPoints!.find(entry => entry.kind === "page")!.nodeId);
  });
  it("defaults to GET and strips query/hash only for routing", () => {
    const site = request('fetch("/api/users?q=1#x");');
    expect(site).toMatchObject({status:"matched", method:"GET", url:"/api/users?q=1#x", path:"/api/users"});
  });
  it("resolves immutable string aliases, imports, reexports and concatenation", () => {
    const analysis = analyze('const alias = URL; const verb = "POST"; fetch(alias, {method:verb});', undefined, [
      {path:"constants.ts", content:'export const BASE = "/api/"; export const URL = BASE + "users";'},
    ]);
    // A same-named unimported symbol must NOT resolve by name.
    expect(analysis.httpRequests![0].reason).toBe("dynamic-url");
    const imported = analyzeSourceFiles([
      {path:"app/page.tsx", content:'import { ENDPOINT } from "../barrel"; export default function Page() { const url = ENDPOINT; const verb = "POST"; fetch(url, {method:verb}); }'},
      {path:"barrel.ts", content:'export { URL as ENDPOINT } from "./constants";'},
      {path:"constants.ts", content:'export const BASE = "/api/"; export const URL = BASE + "users";'},
      {path:"app/api/users/route.ts", content:'export function POST() {}'},
    ]);
    expect(imported.httpRequests![0]).toMatchObject({status:"matched", url:"/api/users", method:"POST"});
    expect(imported.httpRequests![0].valueEvidence.some(proof => proof.location.filePath === "constants.ts")).toBe(true);
  });
  it.each([
    ['fetch(url)', "dynamic-url"],
    ['fetch(`/api/${id}`)', "dynamic-url"],
    ['let url="/api/users"; fetch(url)', "dynamic-url"],
    ['const a=b; const b=a; fetch(a)', "dynamic-url"],
    ['fetch("/api/users", {method:verb})', "dynamic-method"],
    ['fetch("/api/users", options)', "dynamic-method"],
    ['fetch("/api/users", {method:"GET", ...options})', "dynamic-method"],
    ['fetch("/api/users", {method:"TRACE"})', "unsupported-method"],
    ['fetch("https://host/api/users")', "external-url"],
    ['fetch("//host/api/users")', "external-url"],
    ['fetch("/api/%2Fusers")', "encoded-path-separator"],
    ['fetch("/api/../users")', "invalid-path"],
    ['fetch("/api/missing")', "route-not-found"],
    ['const fetch = client; fetch("/api/users")', "unknown-transport"],
    ['fetch?.("/api/users")', "optional-call"],
  ])("keeps %s unresolved (%s)", (body, reason) => {
    const site = request(body);
    expect(site.status).toBe("unresolved"); expect(site.reason).toBe(reason); expect(site.target).toBeUndefined();
  });
  it("does not fall back to a dynamic route when the static path lacks the method", () => {
    const analysis = analyze('fetch("/api/users", {method:"POST"})', [
      {path:"app/api/users/route.ts", content:'export function GET() {}'},
      {path:"app/api/[id]/route.ts", content:'export function POST() {}'},
    ]);
    expect(analysis.httpRequests![0].reason).toBe("method-not-exported");
  });
  it("preserves true and false condition contexts, await and unreachable code", () => {
    const analysis = analyze('if (ok) { await fetch("/api/users"); } else { fetch("/api/users"); } return; fetch("/api/users");');
    const sites = analysis.httpRequests!;
    expect(sites[0].context?.branchPath.at(-1)?.branch).toBe("true");
    expect(sites[1].context?.branchPath.at(-1)?.branch).toBe("false");
    expect(sites[2].context?.reachability).toBe("unreachable-in-model");
    expect(analysis.functionControlFlows![0].awaitSites).toHaveLength(1);
  });
  it("marks CFG unsupported regions and parameter initializers explicitly", () => {
    expect(request('for (;;) { fetch("/api/users"); }').contextStatus).toBe("unsupported-region");
    const analysis = analyzeSourceFiles([{path:"app/page.tsx", content:'export default function Page(arg = fetch("/api/users")) {}'}, {path:"app/api/users/route.ts", content:'export function GET() {}'}]);
    expect(analysis.httpRequests![0].contextStatus).toBe("not-available");
  });
  it.each([
    ["app/api/users/[id]/route.ts", "/api/users/alice", "dynamic", {id:"alice"}],
    ["src/app/api/users/[id]/route.ts", "/api/users/a%20b", "dynamic", {id:"a b"}],
    ["app/api/users/[...slug]/route.ts", "/api/users/a/b", "catch-all", {slug:["a","b"]}],
    ["app/api/users/[[...slug]]/route.ts", "/api/users", "optional-catch-all", {slug:[]}],
  ] as const)("maps %s parameters", (path, url, matchKind, parameters) => {
    const analysis = analyzeSourceFiles([
      {path: path.startsWith("src/") ? "src/app/page.tsx" : "app/page.tsx", content:`export default function Page() { fetch(${JSON.stringify(url)}) }`},
      {path, content:'export function GET() {}'},
    ]);
    expect(analysis.httpRequests![0].target).toMatchObject({matchKind, parameters});
  });
  it("leaves colliding dynamic routes ambiguous even if methods differ", () => {
    const analysis = analyze('fetch("/api/users/1")', [
      {path:"app/api/users/[id]/route.ts",content:'export function GET() {}'},
      {path:"app/api/users/[slug]/route.ts",content:'export function POST() {}'},
    ]);
    expect(analysis.httpRequests![0]).toMatchObject({reason:"ambiguous-route", status:"unresolved"});
    expect(analysis.httpRequests![0].candidates).toHaveLength(2);
  });
  it("preserves two identical same-line request locations despite legacy deduplication", () => {
    const analysis = analyze('fetch("/api/users"); fetch("/api/users");');
    const sites = analysis.httpRequests!;
    expect(sites).toHaveLength(2); expect(sites[0].id).not.toBe(sites[1].id);
    const flow = buildBehaviorFlows(analysis).flows.find(flow => flow.entryPoint.kind === "page")!;
    expect(flow.httpRequests).toHaveLength(2);
    expect(new Set(flow.httpRequests!.map(item => item.boundary!.id)).size).toBe(2);
  });
  it("produces separate HTTP boundaries and reuses backend flow/CFG without response inference", () => {
    const analysis = analyze('try { await fetch("/api/users"); } catch (error) { recover(); }', [{path:"app/api/users/route.ts",content:'function work() { throw new Error("x"); } export function GET() { work(); }'}]);
    const before = structuredClone(analysis);
    const output = buildBehaviorFlows(analysis);
    expect(analysis).toEqual(before);
    const page = output.flows.find(flow => flow.entryPoint.kind === "page")!;
    const boundary = page.httpRequests![0].boundary!;
    const server = output.flows.find(flow => flow.id === boundary.serverFlowId)!;
    expect(boundary).toMatchObject({semantics:"http-boundary", runtimeTransfer:"not-observed", response:"not-analyzed", exceptionPropagation:"not-modeled"});
    expect(server.controlFlows!.some(cfg => cfg.id === boundary.serverControlFlowId)).toBe(true);
    expect(page.edges.every(edge => edge.relation !== "branch" && edge.relation !== "return")).toBe(true);
    expect(validateBehaviorFlow(page, analysis).valid).toBe(true);
  });
  it.each(["method", "target", "context", "semantics"])("rejects forged projected %s", field => {
    const analysis = analyze('if (ok) fetch("/api/users");');
    const page = buildBehaviorFlows(analysis).flows.find(flow => flow.entryPoint.kind === "page")!;
    const finding = page.httpRequests![0];
    if (field === "method") finding.request.method = "POST";
    if (field === "target") finding.boundary!.serverEntryPoint.nodeId = "forged";
    if (field === "context") finding.request.context!.branchPath = [];
    if (field === "semantics") Object.assign(finding.boundary!, {semantics:"static-relation"});
    expect(validateBehaviorFlow(page, analysis).valid).toBe(false);
  });
  it("retains old analyses without HTTP metadata and safely handles unsupported repositories", () => {
    const analysis = analyze('fetch("/api/users")'); delete analysis.httpRequests;
    expect(buildBehaviorFlows(analysis).flows.every(flow => validateBehaviorFlow(flow, analysis).valid)).toBe(true);
    expect(buildBehaviorFlows(analyzeSourceFiles([{path:"README.md",content:"empty"}])).flows).toEqual([]);
  });
  it("resolves fully static templates and shorthand method constants", () => {
    const site = request('const base = "/api"; const method = "POST"; fetch(`${base}/users`, {method});');
    expect(site).toMatchObject({status:"matched", path:"/api/users", method:"POST"});
  });
  it("does not resolve mutable object properties or parameter defaults as constants", () => {
    expect(request('const config={url:"/api/users"}; fetch(config.url)').reason).toBe("dynamic-url");
    const analysis = analyzeSourceFiles([{path:"app/page.tsx",content:'export default function Page(url="/api/users") { fetch(url) }'}]);
    expect(analysis.httpRequests![0].reason).toBe("dynamic-url");
  });
  it("preserves multiline CRLF positions and nested callback ownership", () => {
    const analysis = analyzeSourceFiles([
      {path:"app/page.tsx",content:'export default function Page() {\r\n const handler = () => {\r\n fetch(\r\n "/api/users"\r\n ); };\r\n return <button onClick={handler}>Go</button>;\r\n}'},
      {path:"app/api/users/route.ts",content:'export function GET() {}'},
    ]);
    const site = analysis.httpRequests![0];
    expect(site.location).toMatchObject({startLine:3, startColumn:2, endLine:5, endColumn:3});
    expect(analysis.files[0].functions.find(fn => fn.id === site.ownerFunctionId)?.name).toContain("handler");
    const flow = buildBehaviorFlows(analysis).flows.find(flow => flow.entryPoint.kind === "page")!;
    expect(flow.httpRequests).toHaveLength(1);
    expect(validateBehaviorFlow(flow, analysis).valid).toBe(true);
  });
  it("keeps monorepo applications separate and rejects ambiguous route groups", () => {
    const analysis = analyzeSourceFiles([
      {path:"apps/a/app/page.tsx",content:'export default function Page() { fetch("/api/users") }'},
      {path:"apps/b/app/api/users/route.ts",content:'export function GET() {}'},
    ]);
    expect(analysis.httpRequests![0].reason).toBe("route-not-found");
    const collision = analyze('fetch("/api/users")', [
      {path:"app/(one)/api/users/route.ts",content:'export function GET() {}'},
      {path:"app/(two)/api/users/route.ts",content:'export function GET() {}'},
    ]);
    expect(collision.httpRequests![0].reason).toBe("ambiguous-route");
  });
  it("supports actual handler reexports and ignores type-only exports", () => {
    const good = analyze('fetch("/api/users")', [{path:"app/api/users/route.ts",content:'export { handler as GET } from "../../../handler";'}], [{path:"handler.ts",content:'export function handler() {}'}]);
    expect(good.httpRequests![0].target?.entryPoint).toMatchObject({filePath:"app/api/users/route.ts",method:"GET"});
    const bad = analyze('fetch("/api/users")', [{path:"app/api/users/route.ts",content:'export type { GET } from "../../../handler";'}], [{path:"handler.ts",content:'export function GET() {}'}]);
    expect(bad.httpRequests![0].reason).toBe("method-not-exported");
  });
  it("does not mutate a frozen AST snapshot or the existing graph/CFG", () => {
    const analysis = analyze('const URL="/api/users"; fetch(URL)');
    const original = structuredClone(analysis);
    function freeze(value: unknown) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
    }
    freeze(analysis);
    const flow = buildBehaviorFlows(analysis).flows.find(flow => flow.entryPoint.kind === "page")!;
    expect(flow.httpRequests![0].boundary).toBeDefined();
    expect(analysis).toEqual(original);
    expect(analysis.edges.some(edge => edge.relation === "api")).toBe(false); // additive metadata, legacy graph unchanged
  });
  it("keeps real RepoTutor dynamic requests unresolved instead of guessing connection IDs", () => {
    const paths = ["src/components/repository/RepositoryWorkspace.tsx", "src/components/repository/AiLearningPanel.tsx", "src/app/api/repositories/[connectionId]/analyze/route.ts", "src/app/api/repositories/[connectionId]/learn/route.ts", "src/app/api/analyze/route.ts"];
    const analysis = analyzeSourceFiles(paths.map(path => ({path, content:readFileSync(path, "utf8")})), "repotutor-subset");
    expect(analysis.httpRequests).toHaveLength(3);
    expect(analysis.httpRequests!.every(site => site.reason === "dynamic-url" && !site.target)).toBe(true);
    expect(analysis.httpRequests!.every(site => site.context)).toBe(true);
  });
  it("bounds recursive constant expansion and rejects stale source metadata", () => {
    const aliases = Array.from({length:30}, (_, index) => `const a${index + 1}=a${index}+a${index};`).join(" ");
    expect(request(`const a0="x"; ${aliases} fetch(a30);`).reason).toBe("dynamic-url");
    const analysis = analyze('fetch("/api/users")');
    analysis.httpRequests![0].location.startOffset++;
    const flow = buildBehaviorFlows(analysis).flows.find(flow => flow.entryPoint.kind === "page")!;
    expect(flow.httpRequests).toEqual([]);
  });
});
