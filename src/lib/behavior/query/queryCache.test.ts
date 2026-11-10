import {beforeEach,describe,expect,it} from "vitest";
import {BoundedCache} from "@/lib/cache/boundedCache";
import {coalesceAnalysis} from "@/lib/repository/analysisWork";
import {analyzeSourceFiles} from "@/lib/ast/analyzer";
import {pipelineSources} from "@/lib/behavior/validation/pipelineFixture";
import {buildBehaviorFlow} from "../flowBuilder";
import {clearQueryCaches,featureIndex,getFlowIndex,shortId,snapshot,summaries,queryCacheStats,type QuerySubject} from "./store";
import {graphPage,nodeDetail,cfgPage} from "./projector";
const analysis=analyzeSourceFiles(pipelineSources,"query-fixture");
const subject:QuerySubject={scope:"user/connection/repository",version:"sha-a",source:"connected",analysis};
beforeEach(clearQueryCaches);
function selected(){const feature=featureIndex(subject).features.find(feature=>feature.routePath==="/api/login"&&feature.httpMethod==="POST")!;return shortId("f",snapshot(subject).analysisId,feature.id);}
describe("bounded behavior delivery cache",()=>{
 it("bounds bytes, evicts LRU entries, expires TTL and rejects oversize objects",()=>{
  let now=0;const cache=new BoundedCache<string>(20,2,10,()=>now);
  cache.set("a","one");cache.set("b","two");cache.get("a");cache.set("c","three");expect(cache.get("b")).toBeUndefined();
  expect(cache.stats().serializedBytes).toBeLessThanOrEqual(20);expect(cache.set("huge","x".repeat(100))).toBe(false);
  now=11;expect(cache.get("a")).toBeUndefined();expect(cache.get("c")).toBeUndefined();expect(cache.stats().serializedBytes).toBe(0);
 });
 it("joins duplicate analysis work and releases failed work for retry",async()=>{
  let count=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const work=async()=>{count++;await gate;return 42;};
  const first=coalesceAnalysis("unit-sha",work),second=coalesceAnalysis("unit-sha",work);release();expect(await Promise.all([first,second])).toEqual([42,42]);expect(count).toBe(1);
  await expect(coalesceAnalysis("unit-fail",()=>{throw Error("failure");})).rejects.toThrow("failure");
  expect(await coalesceAnalysis("unit-fail",()=>7)).toBe(7);
 });
 it("preserves original core nodes and relations while leaving full CFG in the AST",async()=>{
  const featureId=selected(),entry=analysis.entryPoints!.find(entry=>entry.routePath==="/api/login")!,raw=buildBehaviorFlow(analysis,entry),before=JSON.stringify(analysis);
  const {index}=await getFlowIndex(subject,featureId);
  expect(index.nodes.filter(node=>node.origin==="behavior").map(node=>node.id).sort()).toEqual(raw.nodes.map(node=>shortId("n",featureId,node.id)).sort());
  expect(index.edges.filter(edge=>edge.semantics!=="source-membership").map(edge=>edge.id).sort()).toEqual(raw.edges.map(edge=>shortId("e",featureId,edge.id)).sort());
  expect(JSON.stringify(index)).not.toContain("sourceCode");expect(JSON.stringify(index)).not.toContain('"controlFlows"');expect(JSON.stringify(analysis)).toBe(before);
 });
 it("caches a feature once and invalidates UI indices for a new version",async()=>{
  const featureId=selected(),a=await getFlowIndex(subject,featureId),b=await getFlowIndex(subject,featureId);expect(a.index).toBe(b.index);expect(queryCacheStats().builds).toBe(1);
  const next={...subject,version:"sha-b"};featureIndex(next);expect(queryCacheStats().flows.entries).toBe(0);
  expect(snapshot(next).analysisId).not.toBe(snapshot(subject).analysisId);
 });
 it("keeps unknown HTTP and fake/cached DB claims unresolved",async()=>{
  const feature=featureIndex(subject).features.find(feature=>feature.routePath==="/api/limits")!,id=shortId("f",snapshot(subject).analysisId,feature.id),{index}=await getFlowIndex(subject,id);
  expect(index.facts.filter(fact=>fact.kind==="database").every(fact=>fact.status==="unresolved")).toBe(true);
  expect(index.facts.some(fact=>fact.kind==="return"&&fact.reason==="return-value-unresolved")).toBe(true);
 });
 it("pages exact source characters and rejects evidence/CFG scope escapes",async()=>{
  const {index}=await getFlowIndex(subject,selected()),root=index.root,detail=nodeDetail(index,analysis,root);
  expect(detail.code?.text).toContain("POST");expect(()=>nodeDetail(index,analysis,root,0,100000)).toThrow();expect(()=>nodeDetail(index,analysis,root,0,0,9999)).toThrow();
  const first=cfgPage(index,analysis,root,0,2),next=cfgPage(index,analysis,root,2,2);
  expect(first.nodes.some(node=>next.nodes.some(other=>other.id===node.id))).toBe(false);
  expect(new Set([...first.edges,...next.edges].map(edge=>edge.id)).size).toBe(first.edges.length+next.edges.length);
 });
 it("separates analysis truncation from viewport hiding and does not invent recoverable counts",async()=>{
  const many=analyzeSourceFiles([{path:"app/page.tsx",content:`${Array.from({length:240},(_,i)=>`function f${i}(){}`).join("\n")}\nexport default function Page(){${Array.from({length:240},(_,i)=>`f${i}();`).join("")}}`}]);
  const s={scope:"large",version:"large-sha",source:"sample" as const,analysis:many},feature=summaries(s)[0],{index}=await getFlowIndex(s,feature.id),graph=graphPage(index,5);
  expect(graph.truncation.analysis).toBe(true);expect(graph.truncation.recoverableByExpansion).toBe(false);expect(graph.truncation.omittedByAnalysis).toBe("unknown");expect(graph.truncation.knownHiddenNodes).toBe(index.nodes.length-graph.nodes.length);
 });
 it("does not borrow confirmed DB provenance from a different server context",async()=>{
  const a=analyzeSourceFiles([
   {path:"app/api/a/route.ts",content:'import {PrismaClient} from "@prisma/client"; import {helper} from "../../../helper"; const client=new PrismaClient(); export function GET(){return helper(client)}'},
   {path:"app/api/b/route.ts",content:'import {helper} from "../../../helper"; export function POST(){return helper(unknown)}'},
   {path:"helper.ts",content:'export async function helper(client){const user=await client.user.findMany(); return Response.json({user});}'},
  ]);
  const s={scope:"context-test",version:"sha",source:"sample" as const,analysis:a};
  const feature=summaries(s).find(item=>item.entryPoint.method==="POST")!,{index}=await getFlowIndex(s,feature.id);
  const creation=index.nodes.find(node=>node.kind==="response-creation")!,detail=nodeDetail(index,a,creation.id),data=detail.facts.items[0].dataSources as Array<{status:string}>;
  expect(data[0].status).toBe("unresolved");
 });
 it("keeps unresolved component props inspectable without claiming DOM bindings",async()=>{
  const feature=summaries(subject).find(item=>item.entryPoint.kind==="page")!,{index}=await getFlowIndex(subject,feature.id);
  const detail=nodeDetail(index,analysis,index.root);
  expect(detail.bindings.items.some(item=>item.reason==="component-prop"&&item.status==="unresolved")).toBe(true);
 });
 it("provides a continuation for response-return data source pages",async()=>{
  const fields=Array.from({length:20},(_,i)=>`field${i}: user`).join(",");
  const a=analyzeSourceFiles([{path:"app/api/a/route.ts",content:`import {PrismaClient} from "@prisma/client"; const prisma=new PrismaClient(); export async function GET(){const user=await prisma.user.findMany();return Response.json({${fields}});}`}]);
  const s={scope:"response-pages",version:"sha",source:"sample" as const,analysis:a},feature=summaries(s)[0],{index}=await getFlowIndex(s,feature.id);
  const returned=index.nodes.find(node=>node.kind==="response-return")!,first=nodeDetail(index,a,returned.id);
  expect(first.facts.nextOffset).toBe(12);const next=nodeDetail(index,a,returned.id,first.facts.nextOffset!);
  expect((first.facts.items[0].dataSources as unknown[])).toHaveLength(12);expect((next.facts.items[0].dataSources as unknown[])).toHaveLength(8);expect(next.facts.nextOffset).toBeNull();
 });

});
