import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";
import { buildBehaviorFlows } from "@/lib/behavior/flowBuilder";
import { validateBehaviorFlow } from "@/lib/behavior/flowValidator";
import type { SourceInput } from "@/types/analysis";

const PRISMA='import {PrismaClient} from "@prisma/client"; const prisma=new PrismaClient();';
function fixture(body:string,prefix="",extra:SourceInput[]=[]) {
  return analyzeSourceFiles([{path:"app/api/users/route.ts",content:`${prefix}\nexport async function GET() { ${body} }`},...extra],"response-example");
}
const flow=(analysis:ReturnType<typeof fixture>)=>buildBehaviorFlows(analysis).flows.find(item=>item.entryPoint.method==="GET")!;
const entryReturns=(analysis:ReturnType<typeof fixture>)=>flow(analysis).serverResponses!.returns.filter(item=>item.kind==="entry-return-reference");

describe("source-backed server responses and local value provenance",()=>{
  it.each([
    ['return Response.json({ok:true});',"","response-json"],
    ['return NextResponse.json({ok:true});','import {NextResponse} from "next/server";',"next-json"],
    ['return NR.json({ok:true});','import {NextResponse as NR} from "next/server";',"next-json"],
    ['return new Response("ok");',"","response-constructor"],
  ])("identifies %s and its actual return reference",(body,prefix,pattern)=>{
    const analysis=fixture(body,prefix),site=analysis.serverResponses!.creations[0];
    expect(site).toMatchObject({pattern,constructorResolution:"confirmed",statusCode:200,statusResolution:"default"});
    expect(entryReturns(analysis)).toHaveLength(1);
    expect(flow(analysis).serverResponses!.runtimeDelivery).toBe("not-established");
    expect(validateBehaviorFlow(flow(analysis),analysis).valid).toBe(true);
  });
  it("preserves conditional 200/400/404/500 statuses and return CFG paths",()=>{
    const analysis=fixture('if(a) return Response.json({}, {status:400}); else if(b) return Response.json({}, {status:404}); try { return Response.json({}, {status:200}); } catch(e) { return new Response("error",{status:500}); }');
    const sites=analysis.serverResponses!.creations;
    expect(sites.map(site=>site.statusCode).sort()).toEqual([200,400,404,500]);
    expect(sites.find(site=>site.statusCode===400)!.context?.branchPath.at(-1)?.branch).toBe("true");
    expect(entryReturns(analysis)).toHaveLength(4);
  });
  it("resolves a literal numeric const and keeps dynamic/spread options unresolved",()=>{
    const analysis=fixture('const STATUS=404; return Response.json({}, {status:STATUS});');
    expect(analysis.serverResponses!.creations[0]).toMatchObject({statusCode:404,statusResolution:"static"});
    for(const options of ['{status:code}','options','{status:200,...options}','{[key]:200}','{get status(){return 200}}','{status:700}']) {
      const site=fixture(`return Response.json({},${options})`).serverResponses!.creations[0];
      expect(site.statusResolution).toBe("unresolved"); expect(site.statusCode).toBeUndefined();
    }
  });
  it("does not turn creation without return into an endpoint response",()=>{
    const analysis=fixture('const unused=Response.json({ok:true}); return null;');
    expect(analysis.serverResponses!.creations).toHaveLength(1);
    expect(entryReturns(analysis)).toEqual([]);
    expect(flow(analysis).serverResponses!.creations[0].returnedBy).toEqual([]);
  });
  it("follows same-function const response aliases",()=>{
    const analysis=fixture('const result=Response.json({ok:true}); const alias=result; return alias;');
    expect(entryReturns(analysis)).toHaveLength(1);
    expect(flow(analysis).serverResponses!.creations[0].returnedBy).toHaveLength(1);
  });
  it("supports expression-bodied App Router handlers",()=>{
    const analysis=analyzeSourceFiles([{path:"app/api/users/route.ts",content:'export const GET=()=>Response.json({ok:true});'}]);
    expect(analysis.serverResponses!.returns[0].implicit).toBe(true);
    expect(entryReturns(analysis)).toHaveLength(1);
  });
  it("links an awaited DB definition to a response field without predicting its value",()=>{
    const analysis=fixture('const user=await prisma.user.findUnique({}); return Response.json({user});',PRISMA);
    const source=analysis.serverResponses!.creations[0].dataSources[0];
    expect(source).toMatchObject({fieldPath:["user"],kind:"database-result",status:"confirmed",databaseSiteId:analysis.databaseAccess!.sites[0].id});
    expect(entryReturns(analysis)[0].dataSources[0]).toMatchObject({sourceId:source.id,status:"confirmed"});
    expect(entryReturns(analysis)[0].dataSources[0].databaseContextId).toBeTruthy();
  });
  it("supports simple aliases, nested objects, and static field projections",()=>{
    const analysis=fixture('const user=await prisma.user.findUnique({}); const alias=user; const payload={user:alias}; return Response.json({nested:{record:payload.user}, id:alias.id});',PRISMA);
    const sources=analysis.serverResponses!.creations[0].dataSources;
    expect(sources.map(source=>source.fieldPath)).toEqual([["nested","record"],["id"]]);
    expect(sources.every(source=>source.kind==="database-result")).toBe(true);
    expect(sources[1].sourcePropertyPath).toEqual(["id"]);
    expect(entryReturns(analysis)[0].dataSources.every(source=>source.status==="confirmed")).toBe(true);
  });
  it("separates same-named const definitions in different branches by declaration identity",()=>{
    const analysis=fixture('if(ok){ const user=await prisma.user.findUnique({}); return Response.json({user}); } else { const user=await prisma.user.findMany({}); return Response.json({user}); }',PRISMA);
    const sites=analysis.serverResponses!.creations;
    expect(new Set(sites.map(site=>site.dataSources[0].databaseSiteId)).size).toBe(2);
    expect(sites.map(site=>site.context!.branchPath.at(-1)!.branch).sort()).toEqual(["false","true"]);
    expect(entryReturns(analysis)).toHaveLength(2);
  });
  it.each([
    'let user=await prisma.user.findMany(); user=other; return Response.json({user});',
    'const user=await prisma.user.findMany(); return Response.json({user:transform(user)});',
    'const user=prisma.user.findMany(); return Response.json({user});',
    'const user=await prisma.user.findMany(); const alias=user; alias.name="changed"; return Response.json({user});',
    'let user; if(ok) user=await prisma.user.findMany(); else user=other; return Response.json({user});',
    'const user=await getUser(); return Response.json({user});',
    'const user=await prisma.user.findMany(); return Response.json({...user});',
    'const user=await prisma.user.findMany(); return Response.json({user, user:other});',
    'const user=await prisma.user.findMany(); return Response.json({user:user[key]});',
  ])("keeps ambiguous/transformed data unresolved: %s",body=>{
    const analysis=fixture(body,PRISMA);
    expect(analysis.serverResponses!.creations[0].dataSources.every(source=>source.status==="unresolved")).toBe(true);
    expect(entryReturns(analysis)[0].dataSources.every(source=>source.status==="unresolved")).toBe(true);
  });
  it("does not link response values declared after use or unsupported conditional definitions",()=>{
    const analysis=fixture('const response=Response.json({user}); const user=await prisma.user.findMany(); return response;',PRISMA);
    expect(entryReturns(analysis)[0].dataSources[0].status).toBe("unresolved");
    const conditional=fixture('const user=ok?await prisma.user.findMany():other; return Response.json({user});',PRISMA);
    expect(entryReturns(conditional)[0].dataSources[0].status).toBe("unresolved");
  });
  it("does not treat an object literal prototype setter as a JSON field",()=>{
    const analysis=fixture('const user=await prisma.user.findMany(); return Response.json({"__proto__":user});',PRISMA);
    expect(entryReturns(analysis)[0].dataSources[0].status).toBe("unresolved");
  });
  it("does not trust shadowed Response/NextResponse or unrelated json methods",()=>{
    for(const prefix of ['const Response={json:()=>({})};','import {NextResponse} from "elsewhere";']) {
      const receiver=prefix.includes("NextResponse")?"NextResponse":"Response";
      const analysis=fixture(`return ${receiver}.json({ok:true});`,prefix);
      expect(analysis.serverResponses!.creations[0].constructorResolution).toBe("unresolved");
      expect(entryReturns(analysis)).toEqual([]);
    }
    const ordinary=fixture('return library.json({ok:true});');
    expect(ordinary.serverResponses!.creations).toEqual([]); expect(entryReturns(ordinary)).toEqual([]);
  });
  it("does not associate unrelated response functions with an API",()=>{
    const analysis=fixture('return null;',"",[{path:"lib/unrelated.ts",content:'export function unused(){return Response.json({ok:true});}'}]);
    expect(analysis.serverResponses!.creations).toHaveLength(1);
    expect(flow(analysis).serverResponses!.creations).toEqual([]);
  });
  it("distinguishes helper-local returns and does not infer their value reaches the API response",()=>{
    const analysis=fixture('return helper();','import {helper} from "../../../lib/helper";',[{path:"lib/helper.ts",content:'export function helper(){return Response.json({ok:true});}'}]);
    const results=flow(analysis).serverResponses!.returns;
    expect(results.map(item=>item.kind).sort()).toEqual(["helper-local-return","unresolved-return"]);
    expect(entryReturns(analysis)).toEqual([]);
  });
  it("uses per-server DB contexts when a helper parameter has different origins",()=>{
    const analysis=fixture('return helper(prisma);',PRISMA+' import {helper} from "../../../lib/helper";',[
      {path:"app/api/other/route.ts",content:'import {helper} from "../../../lib/helper"; export function POST(){return helper(unknown);}'},
      {path:"lib/helper.ts",content:'export async function helper(client){ const user=await client.user.findMany(); return Response.json({user}); }'},
    ]);
    const flows=buildBehaviorFlows(analysis).flows;
    const local=(method:string)=>flows.find(item=>item.entryPoint.method===method)!.serverResponses!.returns.find(item=>item.kind==="helper-local-return")!;
    expect(local("GET").dataSources[0].status).toBe("confirmed");
    expect(local("POST").dataSources[0].status).toBe("unresolved");
  });
  it("retains finally completion contexts without promising which return is delivered",()=>{
    const analysis=fixture('try { return Response.json({ok:true}); } finally { return Response.json({override:true},{status:500}); }');
    expect(entryReturns(analysis)).toHaveLength(2);
    expect(flow(analysis).serverResponses!.runtimeDelivery).toBe("not-established");
    expect(analysis.functionControlFlows!.some(cfg=>cfg.nodes.some(node=>node.context.length))).toBe(true);
  });
  it("does not claim a mutable or conditional response alias is a returned response",()=>{
    for(const body of ['let response=Response.json({}); return response;','const response=ok?Response.json({}):null; return response;']) expect(entryReturns(fixture(body))).toEqual([]);
  });
  it("preserves HTTP/DB/CFG metadata and supports frozen input plus legacy analyses",()=>{
    const analysis=fixture('const user=await prisma.user.findMany(); return Response.json({user});',PRISMA,[{path:"app/page.tsx",content:'export default function Page(){return fetch("/api/users");}'}]);
    const original=structuredClone(analysis);
    function freeze(value:unknown){if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}}
    freeze(analysis);
    const flows=buildBehaviorFlows(analysis).flows,server=flows.find(item=>item.entryPoint.kind==="api")!,page=flows.find(item=>item.entryPoint.kind==="page")!;
    expect(page.httpRequests![0].boundary!.serverFlowId).toBe(server.id);
    expect(server.databaseAccesses).toHaveLength(1);
    expect(flows.every(item=>validateBehaviorFlow(item,analysis).valid)).toBe(true); expect(analysis).toEqual(original);
    const old=fixture('return Response.json({});');delete old.serverResponses;
    expect(flow(old).serverResponses).toBeUndefined();
  });
  it("keeps real RepoTutor wrapper responses local instead of composing their return values",()=>{
    const paths=["src/lib/github/repositoryAccess.ts","src/app/api/repositories/[connectionId]/analyze/route.ts","src/lib/db.ts"];
    const analysis=analyzeSourceFiles(paths.map(path=>({path,content:readFileSync(path,"utf8")})));
    const returns=flow(analysis).serverResponses!.returns;
    expect(analysis.serverResponses!.creations.length).toBeGreaterThan(0);
    expect(returns.some(item=>item.kind==="helper-local-return")).toBe(true);
    expect(returns.some(item=>item.kind==="entry-return-reference")).toBe(false);
  });
  it.each(["delivery","response","source"])("rejects forged projected %s",field=>{
    const analysis=fixture('const user=await prisma.user.findMany(); return Response.json({user});',PRISMA),result=flow(analysis);
    if(field==="delivery") Object.assign(result.serverResponses!,{runtimeDelivery:"delivered"});
    if(field==="response") result.serverResponses!.returns[0].responseSiteId="forged";
    if(field==="source") result.serverResponses!.returns[0].dataSources[0].databaseContextId="forged";
    expect(validateBehaviorFlow(result,analysis).valid).toBe(false);
  });
});
