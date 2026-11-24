import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import { securityFixtures } from "./securityFixtures";
import { scanPresentation } from "@/lib/repository/scanPresentation";

describe("synthetic security analysis comparisons (no network / DB)", () => {
  it("connects cross-file SQL arguments, preserving the real sink location and safe bindings", () => {
    const vulnerable = analyzeSourceFiles(securityFixtures.sqliVulnerable);
    const fixed = analyzeSourceFiles(securityFixtures.sqliFixed);
    expect(vulnerable.sqlInjection?.findings).toHaveLength(1);
    expect(vulnerable.sqlInjection?.findings[0]).toMatchObject({ filePath: "src/search.ts", line: 4, relationship: "input-flow-observed", runtimeExploitation: "not-tested" });
    expect(vulnerable.sqlInjection?.findings[0].apiContexts).toEqual([{ path: "/api/search", method: "GET", filePath: "src/app/api/search/route.ts", relation: "confirmed-call-path" }]);
    expect(vulnerable.sqlInjection?.findings[0].evidence).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: "src/app/api/search/route.ts", line: 3 })]));
    expect(vulnerable.entryPoints).toEqual(expect.arrayContaining([expect.objectContaining({ routePath: "/api/search", method: "GET" })]));
    expect(vulnerable.sqlInjection?.coverage).toMatchObject({ connectedSinks: 1, suspectedCandidates: 0 });
    expect(vulnerable.sqlInjection?.coverage?.inputs).toHaveLength(1);
    expect(vulnerable.sqlInjection?.coverage?.sinks).toHaveLength(1);
    expect(fixed.sqlInjection?.findings).toHaveLength(0);
    expect(fixed.sqlInjection?.coverage?.sinks).toHaveLength(1);
    expect(fixed.sqlInjection?.coverage?.connectedSinks).toBe(1);
  });

  it("traces a cross-file HTML return while JSON, JSX text and textContent stay out of candidates", () => {
    const vulnerable = analyzeSourceFiles(securityFixtures.xssVulnerable);
    const fixed = analyzeSourceFiles(securityFixtures.xssFixed);
    expect(vulnerable.xss?.findings).toHaveLength(1);
    expect(vulnerable.xss?.findings[0]).toMatchObject({ filePath: "src/app/api/echo/route.ts", line: 4, relationship: "input-flow-observed", disposition: "candidate" });
    expect(vulnerable.xss?.findings[0].evidence).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: "src/html.ts", line: 2 })]));
    expect(vulnerable.entryPoints?.[0]).toMatchObject({ routePath: "/api/echo", method: "GET" });
    expect(fixed.xss?.findings).toHaveLength(0);
    expect(fixed.xss?.coverage?.inputs).toHaveLength(2);
  });

  it("distinguishes request ID review from observed ownership filters and suggests the verified identifier", () => {
    const vulnerable = analyzeSourceFiles(securityFixtures.idorVulnerable).accessControl!;
    const fixed = analyzeSourceFiles(securityFixtures.idorFixed).accessControl!;
    expect(vulnerable.findings).toHaveLength(1);
    expect(vulnerable.findings[0]).toMatchObject({ type: "IDOR", line: 5, reviewState: "UNCONFIRMED", api: { path: "/api/orders/[id]", method: "GET" }, planSuggestion: { identifierLocation: "path: id", policyConfirmed: false } });
    expect(fixed.findings[0]).toMatchObject({ type: "IDOR", line: 8, reviewState: "CHECKS_OBSERVED", assessment: "STATIC_REVIEW_ONLY", runtimeExploitation: "not-tested" });
    expect(fixed.findings[0].checks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "ownership", control: "query-filter" })]));
  });

  it("keeps required business roles unconfirmed while extracting an observed server role guard", () => {
    const vulnerable = analyzeSourceFiles(securityFixtures.authorizationVulnerable).accessControl!;
    const fixed = analyzeSourceFiles(securityFixtures.authorizationFixed).accessControl!;
    expect(vulnerable.findings[0]).toMatchObject({ type: "AUTHORIZATION", line: 4, reviewState: "UNCONFIRMED", api: { path: "/api/admin/users", method: "GET" } });
    expect(fixed.findings[0]).toMatchObject({ type: "AUTHORIZATION", line: 7, reviewState: "CHECKS_OBSERVED", planSuggestion: { policyConfirmed: false, observedRoles: ["ADMIN"] } });
    expect(fixed.findings[0].checks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "role", control: "conditional-or-unused" })]));
  });

  it("shows unsupported language/framework and uncertain returns instead of proving absence", () => {
    const language = analyzeSourceFiles(securityFixtures.unsupportedLanguage);
    for (const kind of ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"] as const) expect(scanPresentation(language, kind).status).toBe("unsupported");
    expect(language.diagnostics?.[0]).toMatchObject({ filePath: "api/search.py", kind: "unsupported" });
    const framework = analyzeSourceFiles(securityFixtures.unsupportedFramework);
    expect(framework.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "unsupported", filePath: "server.ts" })]));
    expect(scanPresentation(framework, "IDOR").status).toBe("unsupported");
    const uncertain = analyzeSourceFiles(securityFixtures.uncertainReturn);
    expect(uncertain.xss?.findings[0].relationship).toBe("suspected");
    expect(uncertain.xss?.coverage?.status).toBe("partial");
    expect(uncertain.xss?.coverage?.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not invent candidates for unrelated names or constant IDs", () => {
    const unrelated = analyzeSourceFiles(securityFixtures.unrelated);
    expect(unrelated.sqlInjection?.findings).toEqual([]);
    expect(unrelated.xss?.findings).toEqual([]);
    expect(unrelated.accessControl?.findings).toEqual([]);
    const literal = analyzeSourceFiles([{ path: "app/api/items/route.ts", content: "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); export function GET() { return db.item.findUnique({where:{id:'synthetic'}}); }" }]);
    expect(literal.accessControl?.findings).toEqual([]);
  });

  it("parses uppercase TS/TSX and exposes syntax errors and missing local imports", () => {
    const upper = analyzeSourceFiles([{ path: "src/View.TSX", content: "export function View() { return <p>ok</p>; }" }]);
    expect(upper.files).toHaveLength(1);
    expect(upper.diagnostics).toEqual([]);
    const broken = analyzeSourceFiles([{ path: "app/api/broken/route.ts", content: "import { missing } from './absent';\nexport function GET( { return missing();" }]);
    expect(broken.diagnostics?.map(d => d.kind)).toEqual(expect.arrayContaining(["parse", "unresolved"]));
    expect(scanPresentation(broken, "SQL_INJECTION").status).toBe("partial");
  });

  it("never uses a same-named shadowed helper to establish an input flow", () => {
    const a = analyzeSourceFiles([{ path: "app/api/echo/route.ts", content: "function identity(x) { return x; } export function GET(req) { const identity = unknownFactory(); return new Response(identity(req.url), { headers: { 'Content-Type': 'text/html' } }); }" }]);
    expect(a.xss?.findings[0].relationship).toBe("suspected");
  });

  it("prefills query/body identifiers only from traced resource inputs", () => {
    const query = analyzeSourceFiles([{ path: "app/api/items/route.ts", content: "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); export function GET(req) { const id=new URL(req.url).searchParams.get('itemId'); return db.item.findUnique({where:{id}}); }" }]);
    expect(query.accessControl?.findings[0].planSuggestion?.identifierLocation).toBe("query: itemId");
    const body = analyzeSourceFiles([{ path: "app/api/items/route.ts", content: "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); export async function POST(req) { const body=await req.json(); return db.item.findUnique({where:{id:body.itemId}}); }" }]);
    expect(body.accessControl?.findings[0].planSuggestion?.identifierLocation).toBe("body: itemId");
  });

  it("does not promote ambiguous or recursive function returns to a proven flow", () => {
    const a = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "import {Pool} from 'pg'; const db=new Pool(); function recurse(x) { return recurse(x); } export function GET(req) { return db.query('SELECT ' + recurse(req.url)); }" }]);
    expect(a.sqlInjection?.findings[0].relationship).toBe("suspected");
    expect(a.sqlInjection?.coverage?.status).toBe("partial");
  });

  it("keeps safe Prisma tags and default HTML text escaping out of vulnerability candidates", () => {
    const a = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "import {PrismaClient} from '@prisma/client'; import escape from 'escape-html'; const db=new PrismaClient(); export function GET(req) { const q=req.url; db.$queryRaw`SELECT * FROM items WHERE name=${q}`; return new Response('<p>'+escape(q)+'</p>',{headers:{'Content-Type':'text/html'}}); }" }]);
    expect(a.sqlInjection?.findings).toEqual([]);
    expect(a.sqlInjection?.coverage?.sinks).toHaveLength(1);
    expect(a.sqlInjection?.coverage?.connectedSinks).toBe(1);
    expect(a.xss?.findings).toHaveLength(1);
    expect(a.xss?.findings[0].disposition).toBe("protected");
  });

  it("counts object-form SQL bindings as connected without making them candidates", () => {
    const a = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "import {Pool} from 'pg'; const db=new Pool(); export function GET(req) { return db.query({text:'SELECT * FROM items WHERE name=$1', values:[req.url]}); }" }]);
    expect(a.sqlInjection?.findings).toEqual([]);
    expect(a.sqlInjection?.coverage?.connectedSinks).toBe(1);
  });

  it("includes an unresolved SQL-shaped client in sink counts and preserves intermediate argument evidence", () => {
    const unknown = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "export function GET(req) { const sql='SELECT '+req.url; return external.query(sql); }" }]);
    expect(unknown.sqlInjection?.findings[0].relationship).toBe("suspected");
    expect(unknown.sqlInjection?.coverage?.sinks).toHaveLength(1);
    const chain = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "import {Pool} from 'pg'; const db=new Pool();\nfunction leaf(value) { return db.query('SELECT '+value); }\nfunction middle(value) { return leaf(value); }\nexport function GET(req) { return middle(req.url); }" }]);
    expect(chain.sqlInjection?.findings[0].relationship).toBe("input-flow-observed");
    expect(chain.sqlInjection?.findings[0].evidence.map(item => item.line)).toEqual(expect.arrayContaining([2, 3, 4]));
  });
});
