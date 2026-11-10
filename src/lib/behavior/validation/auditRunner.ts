import {createHash} from "node:crypto";
import {readdir,readFile} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import type {RepositoryAnalysis,SourceInput} from "@/types/analysis";
import {analyzeSourceFiles} from "@/lib/ast/analyzer";
import {buildBehaviorFlow} from "../flowBuilder";
import {validateBehaviorFlow} from "../flowValidator";
import {discoverRepositoryFeatures} from "@/lib/features/featureDiscovery";
import {metrics,scoreRows,type GoldRelation} from "./oracle";

export async function productionSources():Promise<SourceInput[]> {
 async function walk(directory:string):Promise<SourceInput[]> {
  const items=await readdir(directory,{withFileTypes:true}),result:SourceInput[]=[];
  for(const item of items.sort((a,b)=>a.name.localeCompare(b.name))) {
   if(["validation","fixtures"].includes(item.name)) continue;
   const relative=path.join(directory,item.name);
   if(item.isDirectory()) result.push(...await walk(relative));
   else if(/\.[jt]sx?$/.test(item.name)&&!/(?:\.test\.|\.integration\.|\.d\.ts$)/.test(item.name)) result.push({path:relative.replaceAll("\\","/"),content:await readFile(relative,"utf8")});
  }
  return result;
 }
 return walk("src");
}
export const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),"utf8");
export function runPipeline(sources:SourceInput[],repository:string,selections:Array<{route:string;method?:string}>) {
 const start=performance.now(),analysis=analyzeSourceFiles(sources,repository),astMs=performance.now()-start;
 const featureStart=performance.now(),discovery=discoverRepositoryFeatures(analysis),discoveryMs=performance.now()-featureStart;
 const entries=selections.map(selection=>{
  const matches=(analysis.entryPoints??[]).filter(entry=>entry.routePath===selection.route&&entry.method===selection.method);
  if(matches.length!==1) throw Error(`Expected one manually selected entry ${selection.method??"page"} ${selection.route}, found ${matches.length}`);
  return matches[0];
 });
 const measured=entries.map(entry=>{const start=performance.now(),flow=buildBehaviorFlow(analysis,entry),buildMs=performance.now()-start;
  const verifyStart=performance.now(),validation=validateBehaviorFlow(flow,analysis),validationMs=performance.now()-verifyStart;
  return {flow,performance:{entry,buildMs,validationMs,bytes:bytes(flow),nodes:flow.nodes.length,edges:flow.edges.length,status:flow.status,validation},
   limitations:flow.limitations};});
 const features=[...discovery.primary,...discovery.limited,...discovery.hidden];
 const input={analysis,entries,flows:measured.map(item=>item.flow)};
 const sizingStart=performance.now(),astBytes=bytes(analysis),featuresBytes=bytes(discovery),selectedFlowsBytes=bytes(input.flows),sizingMs=performance.now()-sizingStart;
 return {input,measured,features,performance:{astIncludingAllExtractorsMs:astMs,featureDiscoveryMs:discoveryMs,totalMs:performance.now()-start,finalSizingMs:sizingMs,
  astBytes,featuresBytes,selectedFlowsBytes,inputBytes:sources.reduce((sum,item)=>sum+Buffer.byteLength(item.content,"utf8"),0),
  files:sources.length,functions:analysis.stats.functions,rawEdges:analysis.edges.length,entryPoints:analysis.entryPoints?.length??0,
  note:"Single local run after the fixture in the same process, not a cold-start/p95 benchmark. File I/O, process startup and manifest hashing excluded. Compact uncompressed UTF-8 JSON sizes. AST time includes event/CFG/HTTP/DB/response extraction; those stages are not individually instrumented."},
  manifest:sources.map(item=>({path:item.path,sha256:createHash("sha256").update(item.content).digest("hex"),bytes:Buffer.byteLength(item.content,"utf8")}))};
}
export function auditWorkflow(pipeline:ReturnType<typeof runPipeline>,gold:GoldRelation[],route:string,method?:string) {
 const page=pipeline.input.flows.find(flow=>flow.entryPoint.kind==="page"),server=pipeline.input.flows.find(flow=>flow.entryPoint.routePath===route&&flow.entryPoint.method===method);
 if(!server) throw Error("Missing selected server flow");
 const flows=[...(page?[page]:[]),server],rows=scoreRows(gold,{...pipeline.input,flows});
 const byStage=Object.fromEntries([...new Set(gold.map(row=>row.stage))].map(stage=>{
  const slice=rows.filter(row=>row.stage===stage),summary=metrics(slice);
  return [stage,{...summary,status:summary.falseConfirmed||summary.unknownConfirmations?"unsafe-confirmation":summary.missing||summary.unresolvedPositive?"partial":summary.unknownTruth?"unresolved":"verified-in-oracle-scope"}];
 }));
 const labelledIds=new Set(rows.flatMap(row=>[...row.observation.ids,...(row.observation.rawIds??[])]));
 return {route,method,metrics:metrics(rows),byStage,rows,flowStats:flows.map(flow=>pipeline.measured.find(item=>item.flow===flow)!.performance),
  unreviewedOuterEdges:flows.reduce((count,flow)=>count+flow.edges.filter(edge=>!labelledIds.has(edge.id)&&!edge.sourceEdgeIds.some(id=>labelledIds.has(id))).length,0),
  note:"Shared page facts are repeated across workflows; do not sum these as independent repository-wide observations. Unreviewed output is not counted as correct."};
}
/** Referential integrity only, deliberately distinct from semantic accuracy. */
export function referentialErrors(analysis:RepositoryAnalysis,flows:ReturnType<typeof runPipeline>["input"]["flows"]):string[] {
 const errors:string[]=[],nodeIds=new Set(analysis.nodes.map(item=>item.id)),edgeIds=new Set(analysis.edges.map(item=>item.id));
 const cfgs=new Map((analysis.functionControlFlows??[]).map(item=>[item.id,item]));
 const db=new Map((analysis.databaseAccess?.sites??[]).map(item=>[item.id,item]));
 const creations=new Map((analysis.serverResponses?.creations??[]).map(item=>[item.id,item]));
 const returns=new Set((analysis.serverResponses?.returns??[]).map(item=>item.id)),contexts=new Set((analysis.serverResponses?.serverContexts??[]).map(item=>item.id));
 const dataSources=new Set([...creations.values()].flatMap(item=>item.dataSources.map(item=>item.id)));
 const dbContexts=new Set([...db.values()].flatMap(item=>item.serverContexts.map(item=>item.id)));
 const knownFlows=new Set(flows.map(flow=>flow.id));
 for(const flow of flows) {
  for(const item of [...flow.nodes,...flow.edges]) {
   if(item.sourceEdgeIds.some(id=>!edgeIds.has(id))) errors.push("unknown-code-edge");
   if("sourceNodeIds" in item&&item.sourceNodeIds.some(id=>!nodeIds.has(id))) errors.push("unknown-code-node");
  }
  for(const edge of flow.edges) for(const context of edge.callContexts??[]) {
   const cfg=cfgs.get(context.controlFlowId);
   if(!cfg?.callSites.some(site=>site.id===context.callSiteId)||!cfg.statements.some(site=>site.id===context.statementId)) errors.push("dangling-call-context");
  }
  for(const item of flow.httpRequests??[]) if(item.boundary&&!knownFlows.has(item.boundary.serverFlowId)) errors.push("http-target-flow-not-in-selected-corpus");
  for(const item of flow.databaseAccesses??[]) if(!db.has(item.site.id)||!dbContexts.has(item.serverContext.id)) errors.push("dangling-db-id");
  for(const item of flow.serverResponses?.creations??[]) if(!creations.has(item.siteId)||!contexts.has(item.serverContextId)||item.returnedBy.some(id=>!returns.has(id))) errors.push("dangling-response-creation");
  for(const item of flow.serverResponses?.returns??[]) {
   if(!returns.has(item.returnSiteId)||!contexts.has(item.serverContextId)||item.responseSiteId&&!creations.has(item.responseSiteId)) errors.push("dangling-response-return");
   for(const source of item.dataSources) if(!dataSources.has(source.sourceId)||source.databaseContextId&&!dbContexts.has(source.databaseContextId)) errors.push("dangling-response-data-source");
  }
 }
 return errors;
}
