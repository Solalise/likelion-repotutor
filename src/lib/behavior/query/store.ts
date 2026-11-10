import {createHash} from "node:crypto";
import type {RepositoryAnalysis,RepositoryFeature,RepositoryEntryPoint} from "@/types/analysis";
import type {BehaviorEvidence,BehaviorNode} from "@/types/behavior";
import type {BehaviorSnapshot,QueryEdge,QueryNode,QueryFeature} from "@/types/behaviorQuery";
import {BoundedCache} from "@/lib/cache/boundedCache";
import {buildBehaviorFlow} from "../flowBuilder";
import {discoverRepositoryFeatures} from "@/lib/features/featureDiscovery";
import {contextsForCall} from "../controlFlowDetails";

export const shortId=(prefix:string,...parts:unknown[])=>`${prefix}_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0,24)}`;
export class QueryError extends Error {constructor(readonly code:string,message:string,readonly http=400,readonly retryable=false){super(message);}}
export interface QuerySubject {scope:string;version:string;source:BehaviorSnapshot["source"];analysis:RepositoryAnalysis}
export const snapshot=(subject:QuerySubject):BehaviorSnapshot=>({analysisId:shortId("a",subject.scope,subject.version,1),repository:subject.analysis.repository,commitSha:subject.analysis.collection?.commitSha??null,version:subject.version,source:subject.source,sourcePartial:subject.analysis.collection?.partial??false});
export interface Fact {id:string;kind:"http"|"database"|"creation"|"return";rawId:string;contextId?:string;owner:string;status:string;reason?:string;label:string;
 targetFeatureIds?:string[];responseSiteId?:string;sourceStates?:Array<{sourceId:string;status:string;reason?:string;databaseContextId?:string}>;
 location?:{filePath:string;startOffset:number;endOffset:number;startLine:number;endLine:number;startColumn:number;endColumn:number}}
export interface StoredNode extends Omit<QueryNode,"expandable"|"remainingNeighbors"> {sourceIds:string[];bindingId?:string;evidence:Array<Pick<BehaviorEvidence,"location">&{kind:string}>;factId?:string;rawKind:BehaviorNode["kind"]|"artifact"}
export interface FlowIndex {
 snapshot:BehaviorSnapshot;featureId:string;sourceFeatureId:string;entry:RepositoryEntryPoint;root:string;status:"partial"|"unavailable";
 nodes:StoredNode[];edges:QueryEdge[];facts:Fact[];analysisTruncated:boolean;reasons:string[];unresolved:Record<string,number>;unsupported:number;
 coreFlowCounts:{nodes:number;edges:number};
 events:Array<{bindingId:string;owner:string;status:string;reason?:string}>;
}
interface FeatureIndex {features:RepositoryFeature[];entries:RepositoryEntryPoint[]}
const indices=new BoundedCache<FeatureIndex>(4*1024*1024,16,15*60_000);
const flows=new BoundedCache<FlowIndex>(16*1024*1024,64,15*60_000);
const active=new Map<string,string>();
const pending=new Map<string,Promise<FlowIndex>>();
let builds=0;
export function activate(subject:QuerySubject) {
 return observeVersion(subject.scope,subject.version);
}
export function observeVersion(scope:string,version:string) {
 const id=shortId("a",scope,version,1),previous=active.get(scope);
 if(previous&&previous!==id){indices.delete(previous);flows.deletePrefix(`${previous}:`);}
 active.delete(scope);active.set(scope,id);
 while(active.size>64){const scope=active.keys().next().value!,old=active.get(scope)!;indices.delete(old);flows.deletePrefix(`${old}:`);active.delete(scope);}
 return id;
}
export function featureIndex(subject:QuerySubject):FeatureIndex {
 const id=activate(subject),cached=indices.get(id);if(cached)return cached;
 const discovered=discoverRepositoryFeatures(subject.analysis),index={features:[...discovered.primary,...discovered.limited],entries:subject.analysis.entryPoints??[]};
 if(!indices.set(id,index))throw new QueryError("QUERY_CAPACITY","Feature index exceeds the cache budget",413);
 return index;
}
export function findFeature(subject:QuerySubject,id:string) {
 const snap=snapshot(subject),index=featureIndex(subject),feature=index.features.find(item=>shortId("f",snap.analysisId,item.id)===id);
 if(!feature)throw new QueryError("FEATURE_NOT_FOUND","Feature is not in this analysis",404);
 const entry=index.entries.find(item=>item.nodeId===feature.entryNodeId&&item.filePath===feature.entryFilePath&&item.method===feature.httpMethod);
 if(!entry)throw new QueryError("UNSUPPORTED_TARGET","Only verified page/API features are supported",422);
 return {feature,entry};
}
function compact(subject:QuerySubject,feature:RepositoryFeature,entry:RepositoryEntryPoint):FlowIndex {
 const snap=snapshot(subject),featureId=shortId("f",snap.analysisId,feature.id);
 // Existing option, same predicate rules: CFG remains in RepositoryAnalysis and is queried on demand.
 const raw=buildBehaviorFlow(subject.analysis,entry,{includeControlFlow:false});builds++;
 const idMap=new Map(raw.nodes.map(node=>[node.id,shortId("n",featureId,node.id)]));
 const evidence=new Map(raw.evidence.map(item=>[item.id,item]));
 const nodes:StoredNode[]=raw.nodes.map(node=>({id:idMap.get(node.id)!,cfgSummary:{conditions:0,unsupported:0,returns:0},origin:"behavior",kind:node.kind,rawKind:node.kind,label:node.label.slice(0,180),confidence:node.confidence,
  boundary:node.kind==="server"&&node.sourceNodeIds[0]!==entry.nodeId,sourceIds:[...node.sourceNodeIds],bindingId:node.eventBindingId,
  facts:{http:0,database:0,responses:0},cfgAvailable:subject.analysis.functionControlFlows?.some(cfg=>node.sourceNodeIds.includes(cfg.ownerFunctionId))??false,
  evidence:node.evidenceIds.flatMap(id=>{const item=evidence.get(id);return item?[{location:item.location,kind:item.origin.kind}]:[];})}));
 const bySource=new Map(nodes.filter(node=>["function","server","screen"].includes(node.kind)).map(node=>[node.sourceIds[0],node]));
 const cfgs=new Map((subject.analysis.functionControlFlows??[]).map(cfg=>[cfg.ownerFunctionId,cfg]));
 const rawNodes=new Map(raw.nodes.map(node=>[node.id,node]));
 const edges:QueryEdge[]=raw.edges.map(edge=>{
  const source=rawNodes.get(edge.source),target=rawNodes.get(edge.target),cfg=source&&cfgs.get(source.sourceNodeIds[0]);
  const contexts=edge.relation==="call"&&cfg&&target?contextsForCall(cfg,edge.sourceEdgeIds,target.sourceNodeIds[0]):[];
  return {id:shortId("e",featureId,edge.id),source:idMap.get(edge.source)!,target:idMap.get(edge.target)!,relation:edge.relation,semantics:edge.relation==="api-route"?"http-boundary":edge.semantics,
   confidence:edge.confidence,executionOrder:"not-established",conditional:contexts.some(item=>item.branchPath.length>0||item.reachability!=="reachable-in-model")};
 });
 const facts:Fact[]=[];
 function add(fact:Omit<Fact,"id">,kind:string) {
  let owner=bySource.get(fact.owner);
  if(!owner){
   const source=subject.analysis.nodes.find(node=>node.id===fact.owner);
   if(!source||(subject.analysis.entryPoints??[]).some(other=>other.nodeId===fact.owner&&other.nodeId!==entry.nodeId))return;
   owner={id:shortId("n",featureId,"source-reference",fact.owner),cfgSummary:{conditions:0,unsupported:0,returns:0},origin:"metadata",kind:"function",rawKind:"function",label:source.name.slice(0,180),confidence:"confirmed",boundary:false,
    sourceIds:[fact.owner],facts:{http:0,database:0,responses:0},cfgAvailable:cfgs.has(fact.owner),evidence:[]};
   nodes.push(owner);bySource.set(fact.owner,owner);
   const root=raw.entryNodeId?idMap.get(raw.entryNodeId):undefined;
   if(root)edges.push({id:shortId("e",featureId,root,owner.id),source:root,target:owner.id,relation:"server-scope-reference",semantics:"source-membership",confidence:"confirmed",executionOrder:"not-established",conditional:false});
  }
  if(owner.boundary)return;
  const id=shortId("n",featureId,fact.kind,fact.rawId,fact.contextId),record={...fact,id};facts.push(record);
  const group=fact.kind==="http"?"http":fact.kind==="database"?"database":"responses";owner.facts[group]++;
  nodes.push({id,reason:fact.reason,targetFeatureIds:fact.targetFeatureIds,cfgSummary:{conditions:0,unsupported:0,returns:0},origin:"metadata",kind,rawKind:"artifact",label:fact.label.slice(0,180),confidence:fact.status==="confirmed"?"confirmed":"unknown",boundary:false,sourceIds:[fact.owner],facts:{http:0,database:0,responses:0},cfgAvailable:false,factId:id,evidence:[]});
  edges.push({id:shortId("e",featureId,owner.id,id),source:owner.id,target:id,relation:"contains-site",semantics:"source-membership",confidence:"confirmed",executionOrder:"not-established",conditional:false});
 }
 for(const item of raw.httpRequests??[])add({kind:"http",rawId:item.request.id,owner:item.request.ownerFunctionId,status:item.boundary?"confirmed":"unresolved",reason:item.request.reason,
  targetFeatureIds:item.boundary?featureIndex(subject).features.filter(feature=>feature.entryNodeId===item.boundary!.serverEntryPoint.nodeId&&feature.httpMethod===item.boundary!.serverEntryPoint.method&&feature.entryFilePath===item.boundary!.serverEntryPoint.filePath).map(feature=>shortId("f",snap.analysisId,feature.id)):undefined,
  label:`${item.request.method??"?"} ${item.request.path??"unresolved URL"}`,location:item.request.location},"http-request");
 for(const item of raw.databaseAccesses??[])add({kind:"database",rawId:item.site.id,contextId:item.serverContext.id,owner:item.site.ownerFunctionId,status:item.site.status,reason:item.serverContext.reason,
  label:`${item.site.model??"Prisma"}.${item.site.operation??"?"}`,location:item.site.location},"data-access");
 for(const item of raw.serverResponses?.creations??[]){const site=subject.analysis.serverResponses?.creations.find(site=>site.id===item.siteId);if(site)add({kind:"creation",rawId:site.id,contextId:item.serverContextId,owner:site.ownerFunctionId,status:site.constructorResolution,
  sourceStates:raw.serverResponses?.returns.find(returned=>returned.responseSiteId===site.id&&returned.serverContextId===item.serverContextId)?.dataSources,
  label:`${site.pattern} ${site.statusCode??"?"}`,reason:site.statusResolution==="unresolved"?"status-unresolved":undefined,location:site.location},"response-creation");}
 for(const item of raw.serverResponses?.returns??[]){const site=subject.analysis.serverResponses?.returns.find(site=>site.id===item.returnSiteId);if(site)add({kind:"return",rawId:site.id,contextId:item.serverContextId,owner:site.ownerFunctionId,status:item.kind==="unresolved-return"?"unresolved":"confirmed",reason:site.reason,
  sourceStates:item.dataSources,responseSiteId:item.responseSiteId,
  label:item.kind,location:site.location},"response-return");}
 const reasons=[...new Set([...raw.limitations.filter(item=>["traversal-limit","invalid-analysis","partial-source"].includes(item.code)).map(item=>item.code),
  ...(subject.analysis.databaseAccess?.limitations??[]).filter(item=>item.entryPoint?.nodeId===entry.nodeId&&item.entryPoint.method===entry.method&&/limit|boundary/.test(item.code)).map(item=>item.code),
  ...(subject.analysis.serverResponses?.limitations??[]).filter(item=>/limited/.test(item.code)).map(item=>item.code)])];
 const unsupported=[...bySource.keys()].reduce((sum,id)=>sum+(cfgs.get(id)?.statements.filter(item=>item.kind==="unsupported").length??0),0);
 for(const node of nodes)if(node.rawKind!=="artifact"&&!node.boundary){const cfg=cfgs.get(node.sourceIds[0]);node.cfgSummary={conditions:cfg?.statements.filter(item=>item.kind==="if").length??0,unsupported:cfg?.statements.filter(item=>item.kind==="unsupported").length??0,returns:cfg?.statements.filter(item=>item.kind==="return").length??0};}
 const unresolved={relations:raw.unresolved.filter(item=>item.relation!=="api").length,events:(raw.eventBindings??[]).filter(item=>item.status!=="projected").length,
  http:facts.filter(item=>item.kind==="http"&&item.status!=="confirmed").length,database:facts.filter(item=>item.kind==="database"&&item.status!=="confirmed").length,
  responses:facts.filter(item=>["creation","return"].includes(item.kind)&&(item.status!=="confirmed"||item.reason)).length};
 return {snapshot:snap,featureId,sourceFeatureId:feature.id,entry,root:raw.entryNodeId?idMap.get(raw.entryNodeId)!:"",status:raw.status,nodes,edges,facts,analysisTruncated:reasons.length>0,reasons,unresolved,unsupported,coreFlowCounts:{nodes:raw.nodes.length,edges:raw.edges.length},
  events:(raw.eventBindings??[]).map(item=>({bindingId:item.bindingId,owner:item.ownerNodeId,status:item.status,reason:item.reason}))};
}
export async function getFlowIndex(subject:QuerySubject,featureId:string):Promise<{index:FlowIndex;cacheHit:boolean}> {
 const {feature,entry}=findFeature(subject,featureId),id=snapshot(subject).analysisId,key=`${id}:${featureId}`;
 const cached=flows.get(key);if(cached)return {index:cached,cacheHit:true};
 const existing=pending.get(key);if(existing)return {index:await existing,cacheHit:true};
 if(pending.size>=2)throw new QueryError("FLOW_IN_PROGRESS","Flow generation capacity reached; retry",202,true);
 const promise=Promise.resolve().then(()=>{
  const index=compact(subject,feature,entry);
  if(active.get(subject.scope)!==id)throw new QueryError("STALE_ANALYSIS","Analysis changed during projection",409,true);
  if(!flows.set(key,index))throw new QueryError("QUERY_CAPACITY","Flow index exceeds cache budget",413);
  return index;
 });pending.set(key,promise);
 try{return {index:await promise,cacheHit:false};}finally{if(pending.get(key)===promise)pending.delete(key);}
}
export function summaries(subject:QuerySubject):QueryFeature[] {
 const snap=snapshot(subject),index=featureIndex(subject),a=subject.analysis;
 return index.features.map(feature=>{
  const id=shortId("f",snap.analysisId,feature.id),flow=flows.get(`${snap.analysisId}:${id}`),scope=new Set(feature.nodeIds);
  const events=(a.reactEventBindings??[]).filter(item=>item.ownerNodeId&&scope.has(item.ownerNodeId));
  const http=(a.httpRequests??[]).filter(item=>scope.has(item.ownerFunctionId));
  const db=(a.databaseAccess?.sites??[]).filter(item=>scope.has(item.ownerFunctionId));
  const responses=(a.serverResponses?.creations??[]).filter(item=>scope.has(item.ownerFunctionId));
  const count=events.filter(item=>item.status!=="confirmed").length+http.filter(item=>item.status!=="matched").length+db.filter(item=>item.status!=="confirmed").length;
  return {id,sourceFeatureId:feature.id,name:feature.title.slice(0,180),entryPoint:{kind:feature.entryKind==="page"?"page":"api",routePath:feature.routePath??"",method:feature.httpMethod,filePath:feature.entryFilePath},
   status:flow?flow.status:a.collection?.partial?"partial":"indexed",flowStatus:flow?"cached":"not-generated",sourceScopeCounts:{nodes:feature.nodeIds.length,edges:feature.edgeIds?.length??0},flowCounts:flow?{nodes:flow.nodes.length,edges:flow.edges.length}:null,coreFlowCounts:flow?.coreFlowCounts??null,
   presence:{events:events.length>0,http:http.length>0,database:db.length>0,responses:responses.length>0},
   unresolved:{count:flow?Object.values(flow.unresolved).reduce((x,y)=>x+y,0):count,basis:flow?"flow-facts":"source-scope"},
   truncation:{assessment:flow?"assessed":"not-generated",analysis:flow?flow.analysisTruncated:null,reasons:flow?.reasons??[]}};
 });
}
export const queryCacheStats=()=>({indices:indices.stats(),flows:flows.stats(),inFlight:pending.size,builds});
export function clearQueryCaches(){indices.clear();flows.clear();active.clear();pending.clear();builds=0;}
