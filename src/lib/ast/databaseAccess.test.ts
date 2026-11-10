import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import { buildBehaviorFlows } from "@/lib/behavior/flowBuilder";
import { validateBehaviorFlow } from "@/lib/behavior/flowValidator";
import type { SourceInput } from "@/types/analysis";

const IMPORT = 'import { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient();';
function fixture(body: string, extra: SourceInput[] = [], prefix = IMPORT) {
  return analyzeSourceFiles([{path:"app/api/users/route.ts",content:`${prefix}\nexport async function POST() { ${body} }`},...extra], "prisma-example");
}
const sites = (body: string) => fixture(body).databaseAccess!.sites;
const serverFlow = (analysis: ReturnType<typeof fixture>) => buildBehaviorFlows(analysis).flows.find(flow => flow.entryPoint.method === "POST")!;

describe("source-backed Prisma access", () => {
  it.each([
    ["findUnique","read"], ["findMany","read"], ["findFirst","read"], ["findUniqueOrThrow","read"], ["count","read"], ["aggregate","read"], ["groupBy","read"],
    ["create","write"], ["createMany","write"], ["update","write"], ["updateMany","write"], ["delete","write"], ["deleteMany","write"], ["upsert","write"],
  ])("identifies %s from an actual imported constructor", (operation, operationType) => {
    const analysis = fixture(`await prisma.user.${operation}({});`);
    const site = analysis.databaseAccess!.sites[0];
    expect(site).toMatchObject({status:"confirmed",model:"user",operation,operationType});
    expect(site.serverContexts[0].clientEvidence.map(item=>item.kind)).toEqual(expect.arrayContaining(["constructor-import","client-construction"]));
    expect(site.context?.callSiteId).toBeTruthy();
    expect(serverFlow(analysis).databaseAccesses).toHaveLength(1);
  });
  it("handles imported aliases, reexports and local client aliases", () => {
    const analysis = fixture('const alias = client; alias.user.findMany();', [
      {path:"lib/db.ts",content:'import { PrismaClient as Client } from "@prisma/client"; export const db = new Client();'},
      {path:"lib/barrel.ts",content:'export { db as database } from "./db";'},
    ], 'import { database as client } from "../../../lib/barrel";');
    expect(analysis.databaseAccess!.sites[0].status).toBe("confirmed");
    expect(serverFlow(analysis).databaseAccesses![0].serverContext.clientEvidence.some(item=>item.location.filePath==="lib/db.ts")).toBe(true);
  });
  it("identifies a namespace-imported constructor", () => {
    const analysis = fixture('prisma.user.findMany()', [], 'import * as Package from "@prisma/client"; const prisma = new Package.PrismaClient();');
    expect(analysis.databaseAccess!.sites[0].status).toBe("confirmed");
  });
  it("follows proven server calls and binds client arguments per call path", () => {
    const analysis = fixture('if (allowed) await query(prisma); query(other);', [
      {path:"lib/query.ts",content:'export function query(client: unknown) { return client.user.findUnique({}); }'},
    ], IMPORT + ' import { query } from "../../../lib/query";');
    const site = analysis.databaseAccess!.sites.find(site=>site.model==="user")!;
    expect(site.serverContexts.map(item=>item.status)).toEqual(["confirmed","unresolved"]);
    expect(site.serverContexts[0].callPath[0].context?.branchPath.at(-1)?.branch).toBe("true");
    const projected = serverFlow(analysis).databaseAccesses!;
    expect(projected.map(item=>item.site.status).sort()).toEqual(["confirmed","unresolved"]);
    expect(projected.find(item=>item.site.status==="unresolved")!.site.operationType).toBe("unknown");
  });
  it("does not mix separate server entry bindings", () => {
    const analysis = fixture('return query(prisma);',[
      {path:"app/api/other/route.ts",content:'import { query } from "../../../lib/query"; export function GET() { return query(other); }'},
      {path:"lib/query.ts",content:'export function query(client) { return client.user.findUnique({}); }'},
    ],IMPORT + ' import { query } from "../../../lib/query";');
    const flows = buildBehaviorFlows(analysis).flows;
    expect(flows.find(flow=>flow.entryPoint.method==="POST")!.databaseAccesses![0].site.status).toBe("confirmed");
    expect(flows.find(flow=>flow.entryPoint.method==="GET")!.databaseAccesses![0].site.status).toBe("unresolved");
  });
  it("preserves if branches, unreachable code and exact multiline source ranges", () => {
    const analysis = fixture('if (ok) {\n await prisma.user.findMany(\n {}\n );\n} else { prisma.user.delete({}); } return; prisma.user.create({});');
    const list = analysis.databaseAccess!.sites.sort((a,b)=>a.location.startOffset-b.location.startOffset);
    expect(list[0].context?.branchPath.at(-1)?.branch).toBe("true");
    expect(list[1].context?.branchPath.at(-1)?.branch).toBe("false");
    expect(list[2].context?.reachability).toBe("unreachable-in-model");
    for (const site of list) expect(analysis.files[0].sourceCode.slice(site.location.startOffset,site.location.endOffset)).toBe(site.sourceCode);
  });
  it("records transaction registration and callback accesses without a commit claim", () => {
    const analysis = fixture('await prisma.$transaction(async tx => { if (ok) { await tx.user.create({}); } });');
    const list = analysis.databaseAccess!.sites;
    expect(list.find(site=>site.operation==="$transaction")!.status).toBe("confirmed");
    const query = list.find(site=>site.operation==="create")!;
    expect(query.status).toBe("confirmed");
    expect(query.serverContexts[0].callPath[0].kind).toBe("transaction-callback");
    expect(query.serverContexts[0].transactionSiteId).toBe(list.find(site=>site.operation==="$transaction")!.id);
    expect(query.context?.branchPath.at(-1)?.branch).toBe("true");
    const flow = serverFlow(analysis);
    expect(flow.databaseAccesses).toHaveLength(2);
    expect(flow.databaseAccesses!.every(item=>item.transactionCommit==="not-established" && item.queryResult==="not-analyzed")).toBe(true);
    expect(validateBehaviorFlow(flow,analysis).valid).toBe(true);
  });
  it("keeps array transactions and same-line query sites separate", () => {
    const list = sites('await prisma.$transaction([prisma.user.findMany(), prisma.user.findMany()]);');
    expect(list).toHaveLength(3); expect(new Set(list.map(site=>site.id)).size).toBe(3);
    expect(list.every(site=>site.status==="confirmed")).toBe(true);
  });
  it.each([
    ['const db={user:{findMany(){}}}; db.user.findMany()',"unverified-client"],
    ['const db=otherOrm(); db.user.findMany()',"unverified-client"],
    ['prisma.user[operation]({})',"dynamic-operation"],
    ['prisma.user["findMany"]({})',"dynamic-operation"],
    ['prisma.user.customOperation({})',"unsupported-operation"],
    ['const alias=unknown; alias.user.findMany()',"unverified-client"],
    ['let client=prisma; client.user.findMany()',"unverified-client"],
    ['const client=globalThis.prisma ?? new PrismaClient(); client.user.findMany()',"unverified-client"],
    ['prisma?.user.findMany()',"optional-access"],
  ])("does not claim unsupported/unknown access: %s", (body,reason) => {
    const list = sites(body);
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({status:"unresolved",reason,operationType:"unknown"});
  });
  it("does not trust a same-named class or a type-only Prisma import", () => {
    for (const prefix of ['class PrismaClient {} const prisma = new PrismaClient();','import type { PrismaClient } from "@prisma/client"; const prisma = new PrismaClient();']) {
      expect(fixture('prisma.user.findMany()',[],prefix).databaseAccess!.sites[0].status).toBe("unresolved");
    }
  });
  it("does not treat type-only client imports as runtime clients", () => {
    const extra=[{path:"lib/db.ts",content:IMPORT+' export { prisma };'}];
    expect(fixture('client.user.findMany()',extra,'import type {prisma as client} from "../../../lib/db";').databaseAccess!.sites[0].status).toBe("unresolved");
    expect(fixture('Database.prisma.user.findMany()',extra,'import type * as Database from "../../../lib/db";').databaseAccess!.sites[0].status).toBe("unresolved");
  });
  it("rejects mutations through a client alias and reassigned parameters", () => {
    expect(sites('const alias=prisma; alias.user = fake; prisma.user.findMany()')[0].status).toBe("unresolved");
    const analysis = fixture('query(prisma)',[{path:"lib/query.ts",content:'export function query(client) { client=other; return client.user.findMany(); }'}],IMPORT+' import {query} from "../../../lib/query";');
    expect(analysis.databaseAccess!.sites[0].status).toBe("unresolved");
  });
  it("does not treat references to unrelated helpers as invoked server paths", () => {
    const analysis = fixture('const unused = query;', [{path:"lib/query.ts",content:IMPORT+' export function query() { return prisma.user.findMany() }'}], 'import {query} from "../../../lib/query";');
    expect(analysis.databaseAccess!.sites[0].reason).toBe("no-confirmed-server-path");
    expect(serverFlow(analysis).databaseAccesses).toEqual([]);
  });
  it("supports a synchronous proven factory but rejects implicit or foreign returns", () => {
    const good = fixture('client.user.findMany()',[],'import {PrismaClient} from "@prisma/client"; function make() { if (bad) throw Error(); return new PrismaClient(); } const client=make();');
    expect(good.databaseAccess!.sites[0].status).toBe("confirmed");
    const bad = fixture('client.user.findMany()',[],'import {PrismaClient} from "@prisma/client"; function make() { if (ok) return new PrismaClient(); } const client=make();');
    expect(bad.databaseAccess!.sites[0].status).toBe("unresolved");
  });
  it("bounds recursion and preserves unsupported CFG contexts", () => {
    const analysis = fixture('recurse();',[],IMPORT+' function recurse() { for (;;) { prisma.user.findMany(); } recurse(); }');
    expect(analysis.databaseAccess!.sites[0].contextStatus).toBe("unsupported-region");
    expect(analysis.databaseAccess!.limitations.some(item=>item.code==="recursive-call-boundary")).toBe(true);
  });
  it("preserves HTTP -> API flow references and all existing AST graphs", () => {
    const analysis = fixture('prisma.user.findMany()',[{path:"app/page.tsx",content:'export default function Page() { return fetch("/api/users",{method:"POST"}) }'}]);
    const original = structuredClone(analysis);
    function freeze(value: unknown) { if (value && typeof value === "object" && !Object.isFrozen(value)) {Object.freeze(value);Object.values(value).forEach(freeze);} }
    freeze(analysis);
    const flows = buildBehaviorFlows(analysis).flows;
    const page=flows.find(flow=>flow.entryPoint.kind==="page")!, server=flows.find(flow=>flow.entryPoint.kind==="api")!;
    expect(page.httpRequests![0].boundary!.serverFlowId).toBe(server.id);
    expect(page.databaseAccesses).toEqual([]); expect(server.databaseAccesses![0].site.status).toBe("confirmed");
    expect(flows.every(flow=>validateBehaviorFlow(flow,analysis).valid)).toBe(true);
    expect(analysis).toEqual(original);
  });
  it.each(["operation","guard","client","entry","commit"])("rejects forged projected %s", field=>{
    const analysis=fixture('if(ok) prisma.user.findMany()'); const flow=serverFlow(analysis); const item=flow.databaseAccesses![0];
    if(field==="operation") item.site.operation="delete";
    if(field==="guard") item.site.context!.branchPath=[];
    if(field==="client") item.serverContext.clientEvidence=[];
    if(field==="entry") item.serverContext.entryPoint.nodeId="forged";
    if(field==="commit") Object.assign(item,{transactionCommit:"committed"});
    expect(validateBehaviorFlow(flow,analysis).valid).toBe(false);
  });
  it("supports legacy analysis and repositories with no supported DB/server syntax", () => {
    const analysis=fixture('prisma.user.findMany()'); delete analysis.databaseAccess;
    expect(serverFlow(analysis).databaseAccesses).toBeUndefined();
    expect(analyzeSourceFiles([{path:"readme.md",content:"none"}]).databaseAccess!.sites).toEqual([]);
  });
  it("keeps real RepoTutor cached client provenance unresolved", () => {
    const paths=["src/lib/db.ts","src/lib/github/repositoryAccess.ts","src/app/api/repositories/[connectionId]/analyze/route.ts"];
    const analysis=analyzeSourceFiles(paths.map(path=>({path,content:readFileSync(path,"utf8")})));
    expect(analysis.databaseAccess!.sites.length).toBeGreaterThan(0);
    expect(analysis.databaseAccess!.sites.every(site=>site.status==="unresolved")).toBe(true);
    expect(analysis.databaseAccess!.sites.some(site=>site.serverContexts.some(context=>context.reason==="unverified-client"))).toBe(true);
  });
  it("supports a namespace-imported client and multi-hop argument forwarding", () => {
    const analysis=fixture('query(Database.client)',[
      {path:"lib/db.ts",content:'import {PrismaClient} from "@prisma/client"; export const client=new PrismaClient();'},
      {path:"lib/query.ts",content:'function inner(alias) { return alias.user.findMany(); } export function query(client) { return inner(client); }'},
    ],'import * as Database from "../../../lib/db"; import {query} from "../../../lib/query";');
    const site=analysis.databaseAccess!.sites[0];
    expect(site.status).toBe("confirmed"); expect(site.serverContexts[0].callPath).toHaveLength(2);
    expect(serverFlow(analysis).databaseAccesses).toHaveLength(1);
  });
  it("forwards a transaction client to a helper and preserves its association", () => {
    const analysis=fixture('prisma.$transaction(async tx => query(tx))',[
      {path:"lib/query.ts",content:'export function query(client) { return client.user.create({}); }'},
    ],IMPORT+' import {query} from "../../../lib/query";');
    const query=analysis.databaseAccess!.sites.find(site=>site.operation==="create")!;
    expect(query.status).toBe("confirmed");
    expect(query.serverContexts[0].transactionSiteId).toBeTruthy();
    expect(query.serverContexts[0].callPath.map(step=>step.kind)).toEqual(["transaction-callback","call"]);
    expect(serverFlow(analysis).databaseAccesses).toHaveLength(2);
  });
  it("does not assign a spread argument to a fixed parameter position", () => {
    const analysis=fixture('query(...unknown,prisma)',[{path:"lib/query.ts",content:'export function query(first,client) { return client.user.findMany(); }'}],IMPORT+' import {query} from "../../../lib/query";');
    expect(analysis.databaseAccess!.sites[0].status).toBe("unresolved");
  });
  it("does not leak fake transaction bindings from an unknown client", () => {
    const analysis=fixture('other.$transaction(async tx=>tx.user.create({}))');
    expect(analysis.databaseAccess!.sites.every(site=>site.status==="unresolved")).toBe(true);
    expect(serverFlow(analysis).databaseAccesses!.some(item=>item.site.operation==="create")).toBe(false);
  });
  it("supports inline transaction callbacks without parameters using a captured client", () => {
    const analysis=fixture('prisma.$transaction(async ()=>prisma.user.create({}))');
    const create=analysis.databaseAccess!.sites.find(site=>site.operation==="create")!;
    expect(create.status).toBe("confirmed");
    // A captured outer client is not assumed to participate in this transaction.
    expect(create.serverContexts[0].transactionSiteId).toBeUndefined();
    expect(serverFlow(analysis).databaseAccesses).toHaveLength(2);
  });
});
