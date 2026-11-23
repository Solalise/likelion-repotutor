import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import type { SourceInput } from "@/types/analysis";

const db = 'import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient();';
const auth = 'import { getServerSession } from "next-auth";';
function fixture(body: string, extra: SourceInput[] = [], path = "app/api/documents/route.ts", prefix = db) {
  return analyzeSourceFiles([{ path, content: `${prefix}\nexport async function GET(request, context) { ${body} }` }, ...extra]);
}
const candidates = (body: string) => fixture(body).accessControl!.findings.filter(f => f.type === "IDOR");
const id = 'const id = new URL(request.url).searchParams.get("id");';

describe("access control review on the shared repository AST", () => {
  it.each(["findUnique", "update", "delete"])("connects request IDs to actual Prisma %s without claiming exploitation", operation => {
    const report = fixture(`${id} return prisma.document.${operation}({where:{id}});`).accessControl!;
    expect(report.status).not.toBe("failed");
    const f = report.findings.find(f => f.type === "IDOR")!;
    expect(f).toMatchObject({ type: "IDOR", api: { path: "/api/documents", method: "GET", relation: "confirmed" }, operationRelation: "confirmed", assessment: "STATIC_REVIEW_ONLY", runtimeExploitation: "not-tested", reviewState: "UNCONFIRMED" });
    expect(f.inputSources.length).toBeGreaterThan(0);
  });
  it("does not turn literal IDs, authenticated self IDs or unrelated ID variables into findings", () => {
    expect(candidates('const id = "public"; return prisma.document.findUnique({where:{id}});')).toEqual([]);
    expect(fixture('const session = await getServerSession(); return prisma.user.findUnique({where:{id:session.user.id}});', [], undefined, db + auth).accessControl!.findings.filter(f => f.type === "IDOR")).toEqual([]);
    expect(candidates(`${id} return prisma.document.findMany({});`)).toEqual([]);
    expect(candidates(`${id} return fake.document.findUnique({where:{id}});`)).toEqual([]);
  });
  it("observes trusted ownership filters while request-authored ownerId is not protection", () => {
    const trusted = fixture(`${id} const session = await getServerSession(); return prisma.document.findFirst({where:{id,ownerId:session.user.id}});`, [], undefined, db + auth).accessControl!;
    expect(trusted.findings[0].checks).toEqual(expect.arrayContaining([expect.objectContaining({kind:"ownership",relation:"confirmed",control:"query-filter"})]));
    const untrusted = candidates(`${id} return prisma.document.findFirst({where:{id,ownerId:id}});`)[0];
    expect(untrusted.checks.some(c => c.kind === "ownership")).toBe(false);
  });
  it("does not credit OR/NOT ownership expressions as restrictive query filters", () => {
    const f = fixture(`${id} const s = await getServerSession(); return prisma.document.findFirst({where:{id,OR:[{ownerId:s.user.id},{public:true}]}});`, [], undefined, db + auth).accessControl!.findings[0];
    expect(f.checks.some(c => c.control === "query-filter")).toBe(false);
    expect(f.relationship).toBe("suspected");
  });
  it.each(['{OR:[{id},{public:true}]}', '{id:{equals:id}}', '{id:{in:[id,"public"]}}'])("retains input provenance in supported selector syntax %s", where => {
    const f = candidates(`${id} return prisma.document.findFirst({where:${where}});`)[0];
    expect(f.inputSources.length).toBeGreaterThan(0);
  });
  it("keeps rewritten IDs and dynamically changed filters from being credited as proven protection", () => {
    const a=fixture(`${id} const s=await getServerSession(); const where={id,ownerId:s.user.id}; where.ownerId=id; return prisma.document.findFirst({where});`, [], undefined, db+auth);
    expect(a.accessControl!.status).not.toBe("failed");
    expect(a.accessControl!.findings.every(f=>!f.checks.some(c=>c.control==="query-filter"))).toBe(true);
  });
  it("separates authentication reads from post-query ownership comparisons", () => {
    const f = fixture(`${id} const s = await getServerSession(); if(!s.user) return; const doc = await prisma.document.findUnique({where:{id}}); if(doc.ownerId !== s.user.id) return; return Response.json(doc);`, [], undefined, db + auth).accessControl!.findings[0];
    expect(f.checks).toEqual(expect.arrayContaining([expect.objectContaining({kind:"authentication"}), expect.objectContaining({kind:"ownership",control:"after-operation"})]));
    expect(f.assessment).toBe("STATIC_REVIEW_ONLY");
  });
  it("follows request arguments and a real role guard across files", () => {
    const analysis = fixture(`${id} const s = await getServerSession(); requireAdmin(s); return query(id);`, [
      {path:"lib/check.ts",content:'export function requireAdmin(session) { if(session.user.role !== "admin") throw new Error("denied"); }'},
      {path:"lib/query.ts",content:db + ' export function query(id) { return prisma.document.findUnique({where:{id}}); }'},
    ], "app/api/admin/route.ts", auth + 'import { requireAdmin } from "../../../lib/check"; import { query } from "../../../lib/query";');
    const report = analysis.accessControl!;
    expect(report.status).not.toBe("failed");
    const f = report.findings.find(f => f.type === "AUTHORIZATION")!;
    expect(f.checks).toEqual(expect.arrayContaining([expect.objectContaining({kind:"role",relation:"confirmed",control:"guard-before-operation",filePath:"lib/check.ts"})]));
    expect(f.callPath[0].filePath).toBe("app/api/admin/route.ts");
    expect(report.findings.some(f=>f.type==="IDOR")).toBe(true);
  });
  it.each([
    ['function check(s) { return s.user.role === "admin"; }', 'check(s);'],
    ['async function check(s) { if(s.user.role !== "admin") throw Error(); }', 'check(s);'],
    ['function check(s) { if(s.user.role !== "admin") throw Error(); }', 'try { check(s); } catch {}'],
  ])("does not credit ignored returns, unawaited async or caught rejection: %s", (helper, call) => {
    const analysis = fixture(`const s = await getServerSession(); ${call} return prisma.user.deleteMany({});`, [], "app/api/admin/route.ts", db + auth + helper);
    const checks = analysis.accessControl!.findings[0].checks.filter(c=>c.kind==="role");
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.some(c=>c.control==="guard-before-operation")).toBe(false);
  });
  it("does not credit uncalled check definitions or lookalike user objects", () => {
    const f = fixture('const session = {user:{role:"admin"}}; if(session.user.role !== "admin") return; return prisma.user.deleteMany({});', [{path:"lib/unused.ts",content:'export function requireAdmin(s) { if(s.user.role !== "admin") throw Error(); }'}], "app/api/admin/route.ts").accessControl!.findings[0];
    expect(f.checks.some(c=>c.kind==="role" && c.relation==="confirmed")).toBe(false);
  });
  it("records direct role guards, later checks, and awaited helper rejection separately", () => {
    for(const body of [
      'const s=await getServerSession(); if(s.user.role !== "admin") return; return prisma.user.deleteMany({});',
      'const s=await getServerSession(); await check(s); return prisma.user.deleteMany({});',
    ]) {
      const f=fixture(body,[],"app/api/admin/route.ts",db+auth+'async function check(s) { if(s.user.role !== "admin") throw Error(); }').accessControl!.findings[0];
      expect(f.checks.some(c=>c.kind==="role"&&c.control==="guard-before-operation")).toBe(true);
    }
    const f=fixture('const s=await getServerSession(); await prisma.user.deleteMany({}); if(s.user.role !== "admin") return;',[],"app/api/admin/route.ts",db+auth).accessControl!.findings[0];
    expect(f.checks.some(c=>c.kind==="role"&&c.control==="after-operation")).toBe(true);
  });
  it("exposes unsupported custom ORM and partial control flow as review boundaries", () => {
    const a=fixture(`${id} for(const x of rows) { await checkAccess(x); } return unknownDb.document.findUnique({where:{id}});`);
    expect(a.accessControl!.status).toBe("partial");
    expect(a.accessControl!.boundaries.length).toBeGreaterThan(0);
    expect(a.accessControl!.findings).toEqual([]);
  });
  it("marks external auth and middleware applicability as unknown instead of missing protection", () => {
    const report = fixture(`${id} await requirePermission(); return prisma.document.findUnique({where:{id}});`, [{path:"middleware.ts",content:'export function middleware(req) { return verify(req); } export const config={matcher:["/api/:path*"]};'}], undefined, db + 'import { requirePermission } from "policy-package";').accessControl!;
    expect(report.status).toBe("partial");
    expect(report.findings[0].checks).toEqual(expect.arrayContaining([expect.objectContaining({kind:"external-check",relation:"inferred"}),expect.objectContaining({kind:"middleware",relation:"inferred",control:"unresolved"})]));
    expect(report.boundaries.length).toBeGreaterThan(0);
  });
  it("does not invent API suggestions for unresolved higher-order handlers", () => {
    const a = analyzeSourceFiles([{path:"app/api/private/route.ts",content:db + 'export const GET = withAuth(async (request) => prisma.document.findUnique({where:{id:request.params.id}}));'}]);
    expect(a.accessControl!.status).not.toBe("failed");
    expect(a.accessControl!.boundaries.some(b=>b.description.includes("Route Handler"))).toBe(true);
    expect(a.accessControl!.findings.every(f=>!f.api)).toBe(true);
  });
  it("shows client role checks as inferred and follows a matched server API without assuming absent checks", () => {
    const client: SourceInput = {path:"app/panel/page.tsx",content:'"use client"; export default function Panel({user}) { if(user.role !== "admin") return null; return <button onClick={()=>fetch("/api/admin",{method:"POST"})}>Save</button>; }'};
    const a = analyzeSourceFiles([client, {path:"app/api/admin/route.ts",content:'export function POST() { return Response.json({ok:true}); }'}]);
    expect(a.accessControl!.findings.some(f=>f.filePath===client.path && f.operationRelation==="inferred")).toBe(true);
    const guarded = analyzeSourceFiles([client, {path:"app/api/admin/route.ts",content:auth + 'export async function POST() { const s=await getServerSession(); if(s.user.role !== "admin") return new Response("denied",{status:403}); return Response.json({ok:true}); }'}]);
    expect(guarded.accessControl!.findings.some(f=>f.filePath===client.path)).toBe(false);
  });
  it("keeps SQLi and XSS in the same report and produces stable candidate IDs", () => {
    const body = `${id} prisma.$queryRawUnsafe("SELECT * FROM docs WHERE id="+id); const doc=await prisma.document.findUnique({where:{id}}); return new Response(id,{headers:{"Content-Type":"text/html"}});`;
    const a = fixture(body), b = fixture(body);
    expect(a.sqlInjection!.findings.length).toBeGreaterThan(0);
    expect(a.xss!.findings.length).toBeGreaterThan(0);
    expect(a.accessControl!.findings.map(f=>f.id)).toEqual(b.accessControl!.findings.map(f=>f.id));
  });
});
