import {readFile,writeFile} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";
import {beforeAll,describe,expect,it,vi} from "vitest";
vi.mock("@/lib/db",()=>({db:{}}));
vi.mock("@/lib/auth/currentUser",()=>({requireUserId:vi.fn()}));
vi.mock("./source",()=>({resolveQuerySubject:vi.fn()}));
import {resolveQuerySubject} from "./source";
import {GET} from "@/app/api/behavior/route";
import {analyzeSourceFiles} from "@/lib/ast/analyzer";
import {buildBehaviorFlow} from "../flowBuilder";
import {clearGithubAnalysisCacheForTests,setGithubAnalysisCache,githubAnalysisCacheStats} from "@/lib/repository/githubAnalysisCache";
import {clearQueryCaches,getFlowIndex,queryCacheStats,type QuerySubject} from "./store";
import {nodeDetail,graphPage,cfgPage} from "./projector";
import type {SourceInput} from "@/types/analysis";
import type {BehaviorFeaturesResponse,BehaviorGraphResponse} from "@/types/behaviorQuery";

const shouldWrite=process.env.REPOTUTOR_WRITE_DELIVERY_BENCH==="1";
let summary:BehaviorFeaturesResponse,subject:QuerySubject,report:Record<string,unknown>;
const size=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),"utf8");
const paths=[{route:"/repository"},{route:"/api/analyze",method:"GET"},{route:"/api/repositories/[connectionId]/analyze",method:"GET"},{route:"/api/repositories/[connectionId]/learn",method:"POST"}];
async function api(params:Record<string,string>={}){return GET(new Request(`http://localhost/api/behavior?${new URLSearchParams({source:"connected",connectionId:"benchmark",...params})}`));}
beforeAll(async()=>{
 clearQueryCaches();clearGithubAnalysisCacheForTests();
 const compressed=await readFile("docs/validation/behavior-stage4e-input.json.gz"),sources=JSON.parse(gunzipSync(compressed).toString("utf8")) as SourceInput[];
 const start=performance.now(),analysis=analyzeSourceFiles(sources,"RepoTutor-working-tree"),astMs=performance.now()-start;
 subject={scope:"offline-benchmark-user/RepoTutor",version:createHash("sha256").update(compressed).digest("hex"),source:"connected",analysis};
 const astCacheStart=performance.now();setGithubAnalysisCache(`benchmark@${subject.version}`,analysis);const astCacheAdmissionMs=performance.now()-astCacheStart;
 vi.mocked(resolveQuerySubject).mockResolvedValue({subject,revalidate:async()=>{}});
 const baseline=[];
 for(const selection of paths){
  const entry=analysis.entryPoints!.find(entry=>entry.routePath===selection.route&&entry.method===selection.method)!,time=performance.now(),flow=buildBehaviorFlow(analysis,entry),buildMs=performance.now()-time;
  baseline.push({entry,buildMs,bytes:size(flow),parts:{cfg:size(flow.controlFlows),evidence:size(flow.evidence),nodes:size(flow.nodes),edges:size(flow.edges),http:size(flow.httpRequests),database:size(flow.databaseAccesses),responses:size(flow.serverResponses)}});
 }
 const summaryStart=performance.now(),summaryResponse=await api();summary=await summaryResponse.json();const summaryMs=performance.now()-summaryStart;
 expect(summaryResponse.status).toBe(200);expect(summary.features.every(feature=>feature.flowStatus==="not-generated")).toBe(true);
 const measured=[];
 for(const selection of paths){
  const feature=summary.features.find(feature=>feature.entryPoint.routePath===selection.route&&feature.entryPoint.method===selection.method)!;
  const cold=performance.now(),response=await api({view:"flow",analysisId:summary.snapshot.analysisId,featureId:feature.id}),graph=await response.json() as BehaviorGraphResponse,coldMs=performance.now()-cold;
  expect(response.status).toBe(200);expect(size(graph)).toBeLessThan(256*1024);expect(graph.nodes.length).toBeLessThanOrEqual(24);
  const {index}=await getFlowIndex(subject,feature.id),functions=new Map(analysis.files.flatMap(file=>file.functions).map(fn=>[fn.id,fn]));
  const largest=index.nodes.filter(node=>node.origin==="behavior"&&!node.boundary&&["function","screen","server"].includes(node.kind)).sort((a,b)=>(functions.get(b.sourceIds[0])?.sourceCode.length??0)-(functions.get(a.sourceIds[0])?.sourceCode.length??0))[0];
  const detailStart=performance.now(),detailResponse=await api({view:"node",analysisId:summary.snapshot.analysisId,featureId:feature.id,nodeId:largest.id}),detail=await detailResponse.json(),detailMs=performance.now()-detailStart;
  expect(detailResponse.status).toBe(200);expect(size(detail)).toBeLessThan(256*1024);expect(detail.code.text.length).toBeLessThanOrEqual(6000);
  const expandStart=performance.now(),expandResponse=await api({view:"expand",analysisId:summary.snapshot.analysisId,featureId:feature.id,nodeId:graph.rootId,visible:graph.visibleNodeIds.join(",")}),expansion=await expandResponse.json(),expandMs=performance.now()-expandStart;
  expect(expandResponse.status).toBe(200);expect(size(expansion)).toBeLessThan(256*1024);
  const cfgStart=performance.now(),cfgResponse=await api({view:"cfg",analysisId:summary.snapshot.analysisId,featureId:feature.id,nodeId:largest.id,limit:"40"}),cfg=await cfgResponse.json(),cfgMs=performance.now()-cfgStart;
  expect(cfgResponse.status).toBe(200);expect(size(cfg)).toBeLessThan(256*1024);
  const repeats=[];for(let i=0;i<20;i++){const time=performance.now();const again=await api({view:"flow",analysisId:summary.snapshot.analysisId,featureId:feature.id});expect(again.status).toBe(200);await again.json();repeats.push(performance.now()-time);}
  repeats.sort((a,b)=>a-b);
  measured.push({selection,featureId:feature.id,coldFlowMs:coldMs,initialBytes:size(graph),initialNodes:graph.nodes.length,available:graph.available,truncation:graph.truncation,
   nodeDetail:{ms:detailMs,bytes:size(detail),function:largest.label,totalChars:detail.code.totalChars,nextCodeOffset:detail.code.nextOffset},
   expansion:{ms:expandMs,bytes:size(expansion),visibleNodes:expansion.visibleNodeIds.length},cfg:{ms:cfgMs,bytes:size(cfg),nodes:cfg.nodes.length,total:cfg.total,nextOffset:cfg.nextOffset},
   repeats:{n:20,p50Ms:repeats[9],p95Ms:repeats[18],maxMs:repeats[19]},compactIndexBytes:size(index),page48Bytes:size(graphPage(index,48))});
 }
 report={schemaVersion:1,createdAtUtc:new Date().toISOString(),environment:{node:process.version,platform:process.platform},input:{files:sources.length,compressedSha256:createHash("sha256").update(compressed).digest("hex"),sourceBytes:sources.reduce((sum,item)=>sum+Buffer.byteLength(item.content,"utf8"),0),basis:"Exact archived 4-D working-tree input, not current 4-E source."},
  scope:"Real API GET handler and real RepoTutor analysis, offline authorization/HEAD adapter mocked. Network/DB/auth latency and source download excluded. Warm percentiles are 20 local calls per feature, not production SLO.",
  astMs,astCacheAdmissionMs,baseline:{flows:baseline,totalFlowBuildMs:baseline.reduce((sum,item)=>sum+item.buildMs,0),fourFlowBytes:baseline.reduce((sum,item)=>sum+item.bytes,0)+baseline.length+1},
  delivery:{summaryMs,summaryBytes:size(summary),features:summary.features.length,rows:measured,cache:queryCacheStats(),astCache:githubAnalysisCacheStats(),heapUsedBytes:process.memoryUsage().heapUsed},
  notes:["Analysis predicates unchanged. Original CFG and all source/evidence remain in bounded AST cache.","Summary Flow counts are null until selected; source-scope counts are explicitly separate.","Cold AST and core Flow generation still cost seconds; only read payloads/repeated work optimized.","Cache limits account serialized bytes, not V8 heap/RSS; heap sample includes benchmark transient allocations."]};
 if(shouldWrite){await writeFile("docs/validation/behavior-delivery-stage4e.json",JSON.stringify(report,null,2)+"\n");await writeFile("docs/validation/behavior-delivery-example-stage4e.json",JSON.stringify({features:summary,firstGraph:await(await api({view:"flow",analysisId:summary.snapshot.analysisId,featureId:measured[0].featureId})).json()},null,2)+"\n");}
},180000);

describe("4-E frozen real-repository data supply",()=>{
 it("uses the original corpus and supplies summaries without full Flow generation",()=>{expect(subject.analysis.files).toHaveLength(91);expect(summary.features.length).toBeGreaterThanOrEqual(4);expect(size(summary)).toBeLessThan(64*1024);});
 it("builds each selected Flow once and obeys both cache budgets",()=>{expect(queryCacheStats().builds).toBe(4);expect(queryCacheStats().flows.serializedBytes).toBeLessThanOrEqual(queryCacheStats().flows.maxBytes);expect(githubAnalysisCacheStats().serializedBytes).toBeLessThanOrEqual(githubAnalysisCacheStats().maxBytes);});
 it("keeps full source available through code pagination without copying entire CFG",async()=>{
  const feature=summary.features.find(feature=>feature.entryPoint.routePath==="/repository")!,{index}=await getFlowIndex(subject,feature.id);
  const node=index.nodes.find(node=>node.label==="RepositoryWorkspace")!,first=nodeDetail(index,subject.analysis,node.id);
  expect(first.code!.nextOffset).not.toBeNull();const next=nodeDetail(index,subject.analysis,node.id,0,first.code!.nextOffset!);
  expect(next.code!.startOffset).toBe(first.code!.endOffset);expect(first.code!.text+next.code!.text).toBe(subject.analysis.files.find(file=>file.path===first.code!.filePath)!.sourceCode.slice(first.code!.startOffset,next.code!.endOffset));
  expect(cfgPage(index,subject.analysis,node.id,0,40).nodes.length).toBeLessThanOrEqual(40);
 });
});
