import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import type { RepositoryAnalysis, SourceInput } from "@/types/analysis";
import { buildLearningContext } from "@/lib/ai/learningContext";
import { buildRepositoryLearningGraph } from "@/lib/learning/learningGraphBuilder";

const handler = (path: string, methods = ["GET"]): SourceInput => ({
  path, content: methods.map((method) => `export function ${method}() { return true; }`).join("\n"),
});
function analyze(request: string, routes: SourceInput[], filePath = "src/client.ts", imports = "") {
  return analyzeSourceFiles([{ path: filePath, content: `${imports}\nexport function request(input: string, method: string, options: any) { return ${request}; }` }, ...routes]);
}
const apiEdges = (analysis: RepositoryAnalysis) => analysis.edges.filter((edge) => edge.relation === "api");
const apiRelations = (analysis: RepositoryAnalysis) => analysis.files.flatMap((file) => file.functions.flatMap((fn) => fn.relations ?? [])).filter((relation) => relation.relation === "api");

describe("statically justified App Router API connections", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])("selects only the exported %s handler for the same URL", (method) => {
    const analysis = analyze(`fetch('/api/users', { method: '${method}' })`, [handler("src/app/api/users/route.ts", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])]);
    expect(apiEdges(analysis)).toHaveLength(1);
    const target = analysis.nodes.find((node) => node.id === apiEdges(analysis)[0].target)!;
    expect(target.name).toBe(method);
    expect(apiEdges(analysis)[0].confidence).toBe("confirmed");
  });

  it("defaults to GET only when the method is absent in known options", () => {
    const analysis = analyze("fetch('/api/users', { headers: { Accept: 'application/json' } })", [handler("app/api/users/route.ts")]);
    expect(apiRelations(analysis)[0]).toMatchObject({ requestMethod: "GET", confidence: "confirmed" });
  });

  it("retains missing routes and unsupported methods as unresolved instead of attaching a nearby node", () => {
    for (const request of ["fetch('/api/missing')", "fetch('/api/users', { method: 'POST' })"]) {
      const analysis = analyze(request, [handler("app/api/users/route.ts")]);
      expect(apiEdges(analysis)).toEqual([]);
      expect(apiRelations(analysis)[0]).toMatchObject({ targetId: undefined, confidence: "inferred" });
      expect(analysis.stats.unmatchedApiRequests).toBe(1);
    }
  });

  it("prefers a static route over dynamic routes independently of file order", () => {
    const routes = [handler("app/api/users/[id]/route.ts"), handler("app/api/users/me/route.ts")];
    for (const order of [routes, [...routes].reverse()]) {
      const analysis = analyze("fetch('/api/users/me?details=1#section')", order);
      expect(analysis.nodes.find((node) => node.id === apiEdges(analysis)[0]?.target)?.filePath).toBe("app/api/users/me/route.ts");
    }
  });

  it("does not fall back to a dynamic route when the static route lacks the requested method", () => {
    const analysis = analyze("fetch('/api/users/me', { method: 'POST' })", [handler("app/api/users/[id]/route.ts", ["POST"]), handler("app/api/users/me/route.ts", ["GET"])]);
    expect(apiEdges(analysis)).toEqual([]);
  });

  it("matches a literal URL against a dynamic segment without crossing segment boundaries", () => {
    const route = handler("app/api/users/[id]/route.ts");
    expect(apiEdges(analyze("fetch('/api/users/42/')", [route]))).toHaveLength(1);
    expect(apiEdges(analyze("fetch('/api/users/42/details')", [route]))).toEqual([]);
    expect(apiEdges(analyze("fetch('/api/users')", [route]))).toEqual([]);
  });

  it("respects single-segment, catch-all and optional catch-all specificity", () => {
    const routes = [handler("app/api/files/[[...optional]]/route.ts"), handler("app/api/files/[...rest]/route.ts"), handler("app/api/files/[id]/route.ts")];
    for (const [url, expected] of [["/api/files/a", "[id]"], ["/api/files/a/b", "[...rest]"], ["/api/files", "[[...optional]]"]]) {
      const analysis = analyze(`fetch('${url}')`, routes);
      expect(analysis.nodes.find((node) => node.id === apiEdges(analysis)[0]?.target)?.filePath).toBe(`app/api/files/${expected}/route.ts`);
    }
  });

  it("keeps identical API paths inside their own application", () => {
    const routes = [handler("apps/admin/src/app/api/users/route.ts"), handler("apps/store/app/api/users/route.ts")];
    for (const app of ["admin", "store"]) {
      const analysis = analyze("fetch('/api/users')", routes, `apps/${app}/src/services/users.ts`);
      expect(apiEdges(analysis)).toHaveLength(1);
      expect(analysis.nodes.find((node) => node.id === apiEdges(analysis)[0].target)?.filePath).toContain(`apps/${app}/`);
    }
    for (const caller of ["apps/mobile/src/service.ts", "packages/shared/client.ts", "src/shared.ts"]) {
      expect(apiEdges(analyze("fetch('/api/users')", routes, caller))).toEqual([]);
    }
  });

  it("does not use another app's route when the caller's own app lacks it", () => {
    const analysis = analyze("fetch('/api/users')", [handler("apps/admin/app/api/other/route.ts"), handler("apps/store/app/api/users/route.ts")], "apps/admin/src/client.ts");
    expect(apiEdges(analysis)).toEqual([]);
  });

  it.each([
    "fetch(`/api/users/${input}`)",
    "fetch(input)",
    "fetch('/api/users', { method })",
    "fetch('/api/users', options)",
    "fetch('/api/users', { method: 'GET', ...options })",
    "fetch('/api/users', { [method]: 'GET' })",
    "fetch(buildApiUrl('/api/users'))",
    "fetch('https://other.example/api/users')",
    "fetch('//other.example/api/users')",
  ])("does not invent a local target for %s", (request) => {
    const analysis = analyze(request, [handler("app/api/users/route.ts"), handler("app/api/users/[id]/route.ts")]);
    expect(apiEdges(analysis)).toEqual([]);
    expect(apiRelations(analysis)).toHaveLength(1);
    expect(apiRelations(analysis)[0]).toMatchObject({ confidence: "inferred", targetId: undefined });
    expect(analysis.stats.unmatchedApiRequests).toBe(1);
  });

  it("accepts actual exports and re-exported handlers, but not private or default-only functions", () => {
    const privateRoute = { path: "app/api/users/route.ts", content: "function GET() { return 1; } export default GET;" };
    expect(apiEdges(analyze("fetch('/api/users')", [privateRoute]))).toEqual([]);
    const alias = analyze("fetch('/api/users')", [
      { path: "app/api/users/route.ts", content: "export { serve as GET } from '../../handlers';" },
      { path: "app/handlers.ts", content: "export function serve() { return true; }" },
    ]);
    expect(apiEdges(alias)).toHaveLength(1);
    expect(alias.nodes.find((node) => node.id === apiEdges(alias)[0].target)?.name).toBe("serve");
  });

  it("leaves equally specific route-group duplicates unresolved", () => {
    const analysis = analyze("fetch('/api/users')", [handler("app/(one)/api/users/route.ts"), handler("app/(two)/api/users/route.ts")]);
    expect(apiEdges(analysis)).toEqual([]);
  });

  it("does not treat type-only re-exports as runtime API handlers", () => {
    const analysis = analyze("fetch('/api/users')", [
      { path: "app/api/users/route.ts", content: "export type { serve as GET } from '../../handlers';" },
      { path: "app/handlers.ts", content: "export function serve() { return true; }" },
    ]);
    expect(apiEdges(analysis)).toEqual([]);
  });

  it("handles route groups and root app precedence over src/app", () => {
    const grouped = analyze("fetch('/api/users')", [handler("src/app/(public)/api/users/route.ts")]);
    expect(apiEdges(grouped)).toHaveLength(1);
    const root = analyze("fetch('/api/users')", [handler("src/app/api/users/route.ts"), handler("app/api/users/route.ts")]);
    expect(root.nodes.find((node) => node.id === apiEdges(root)[0]?.target)?.filePath).toBe("app/api/users/route.ts");
  });

  it("does not attach private folders or interception/parallel paths as ordinary routes", () => {
    const analysis = analyze("fetch('/api/users')", [handler("app/_hidden/api/users/route.ts"), handler("app/@slot/api/users/route.ts"), handler("app/(.)api/users/route.ts")]);
    expect(apiEdges(analysis)).toEqual([]);
  });

  it("confirms imported axios methods/configs but leaves unknown clients and base URLs inferred", () => {
    for (const request of ["axios.delete('/api/users')", "axios({ url: '/api/users', method: 'DELETE' })"]) {
      const analysis = analyze(request, [handler("app/api/users/route.ts", ["DELETE"])], "src/client.ts", "import axios from 'axios';");
      expect(apiEdges(analysis)).toHaveLength(1);
    }
    for (const request of ["api.get('/api/users')", "axios.get('/api/users', { baseURL: input })", "axios({ url: '/api/users', method })"]) {
      const analysis = analyze(request, [handler("app/api/users/route.ts")], "src/client.ts", "import axios from 'axios';");
      expect(apiEdges(analysis)).toEqual([]);
      expect(apiRelations(analysis)[0].confidence).toBe("inferred");
    }
  });

  it("does not mistake a local function named fetch for the platform API", () => {
    const analysis = analyze("fetch('/api/users')", [handler("app/api/users/route.ts")], "src/client.ts", "function fetch(path: string) { return path; }");
    expect(apiEdges(analysis)).toEqual([]);
  });

  it("does not hide an unresolved request behind a resolved request on the same line", () => {
    const analysis = analyze("[fetch('/api/users'), fetch('/api/missing')]", [handler("app/api/users/route.ts")]);
    expect(apiEdges(analysis)).toHaveLength(1);
    expect(analysis.stats.unmatchedApiRequests).toBe(1);
  });

  it("feeds only resolved API targets into learning and AI context", () => {
    const analysis = analyze("[fetch('/api/users'), fetch('/api/unknown')]", [handler("app/api/users/route.ts")]);
    const caller = analysis.nodes.find((node) => node.name === "request")!;
    const graph = buildRepositoryLearningGraph(analysis);
    expect(graph.edges).toEqual([expect.objectContaining({ relation: "request", confidence: "confirmed" })]);
    const context = buildLearningContext(analysis, { type: "function", functionId: caller.id });
    expect(context.code[0].relations).toEqual([expect.objectContaining({ relation: "api", confidence: "confirmed" })]);
    expect(context.candidateCodeCount).toBe(2);
  });
});
