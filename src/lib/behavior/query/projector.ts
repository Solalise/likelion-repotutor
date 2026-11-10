import type {RepositoryAnalysis} from "@/types/analysis";
import type {BehaviorGraphResponse,BehaviorNodeDetail,BehaviorCfgResponse,QueryNode,CodeChunk} from "@/types/behaviorQuery";
import type {FlowIndex,StoredNode,Fact} from "./store";
import {QueryError,shortId} from "./store";
import {validateFunctionControlFlow} from "@/lib/controlFlow/validator";

export const QUERY_LIMITS={initial:24,maxPage:64,maxVisible:256,codeChars:6000,factPage:12,evidencePage:8};
export function requireNode(index:FlowIndex,id:string){const node=index.nodes.find(node=>node.id===id);if(!node)throw new QueryError("NODE_NOT_FOUND","Node does not belong to this feature",404);return node;}
function describe(index:FlowIndex,node:StoredNode,visible:Set<string>):QueryNode {
 const neighbors=new Set(index.edges.flatMap(edge=>edge.source===node.id?[edge.target]:edge.target===node.id?[edge.source]:[]));
 const remaining=[...neighbors].filter(id=>!visible.has(id)).length;
 return {id:node.id,reason:node.reason,targetFeatureIds:node.targetFeatureIds,cfgSummary:node.cfgSummary,origin:node.origin,kind:node.kind,label:node.label,confidence:node.confidence,boundary:node.boundary,facts:node.facts,cfgAvailable:node.cfgAvailable&&!node.boundary,expandable:remaining>0,remainingNeighbors:remaining};
}
export function graphPage(index:FlowIndex,limit=QUERY_LIMITS.initial,anchor=index.root,visibleIds:string[]=[],expand=false):BehaviorGraphResponse {
 if(index.status==="unavailable")return {snapshot:index.snapshot,featureId:index.featureId,status:"unavailable",rootId:"",nodes:[],edges:[],visibleNodeIds:[],available:{nodes:0,edges:0},coreFlowCounts:index.coreFlowCounts,
  truncation:{analysis:true,reasons:index.reasons,omittedByAnalysis:"unknown",recoverableByExpansion:false,analysisRecoverableByExpansion:false,viewportCanExpand:false,projection:false,knownHiddenNodes:0,knownHiddenEdges:0},unresolved:index.unresolved,unsupportedRegions:index.unsupported,metadata:{http:0,database:0,responses:0},limits:QUERY_LIMITS};
 requireNode(index,anchor);if(limit<1||limit>QUERY_LIMITS.maxPage)throw new QueryError("INVALID_LIMIT","Invalid node page size");
 if(visibleIds.length>QUERY_LIMITS.maxVisible)throw new QueryError("VIEWPORT_LIMIT","Focus a node to reset the viewport",409);
 const visible=new Set(expand?visibleIds:[]);for(const id of visible)requireNode(index,id);
 const before=new Set(visible),queue=[anchor],visited=new Set<string>();let added=0;
 const priorities=new Map(index.nodes.map(node=>[node.id,node.kind==="event"?0:node.kind==="http-request"?1:node.origin==="behavior"?3:4]));
 for(const edge of index.edges)if(edge.relation==="event-binding"&&(priorities.get(edge.source)??4)>2)priorities.set(edge.source,2);
 for(let cursor=0;cursor<queue.length&&added<limit;cursor++) {
  const id=queue[cursor];if(visited.has(id))continue;visited.add(id);
  if(!visible.has(id)){if(visible.size>=QUERY_LIMITS.maxVisible)break;visible.add(id);added++;}
  const adjacent=index.edges.flatMap(edge=>edge.source===id?[edge.target]:expand&&edge.target===id?[edge.source]:[]);
  queue.push(...adjacent.sort((a,b)=>(priorities.get(a)??4)-(priorities.get(b)??4)||a.localeCompare(b)));
 }
 const knownEdges=index.edges.filter(edge=>visible.has(edge.source)&&visible.has(edge.target));
 const responseNodes=index.nodes.filter(node=>visible.has(node.id)&&(!expand||!before.has(node.id)||node.id===anchor));
 return {snapshot:index.snapshot,featureId:index.featureId,status:index.status,rootId:anchor,nodes:responseNodes.map(node=>describe(index,node,visible)),edges:expand?knownEdges.filter(edge=>!before.has(edge.source)||!before.has(edge.target)):knownEdges,
  visibleNodeIds:[...visible],available:{nodes:index.nodes.length,edges:index.edges.length},coreFlowCounts:index.coreFlowCounts,
  truncation:{analysis:index.analysisTruncated,reasons:index.reasons,omittedByAnalysis:index.analysisTruncated?"unknown":"none",recoverableByExpansion:false,analysisRecoverableByExpansion:false,viewportCanExpand:visible.size<index.nodes.length&&visible.size<QUERY_LIMITS.maxVisible,
   projection:visible.size<index.nodes.length,projectionReason:visible.size<index.nodes.length?visible.size>=QUERY_LIMITS.maxVisible?"viewport-limit":"page-limit":undefined,knownHiddenNodes:index.nodes.length-visible.size,knownHiddenEdges:index.edges.length-knownEdges.length},
  unresolved:index.unresolved,unsupportedRegions:index.unsupported,metadata:{http:index.facts.filter(fact=>fact.kind==="http").length,database:index.facts.filter(fact=>fact.kind==="database").length,responses:index.facts.filter(fact=>["return","creation"].includes(fact.kind)).length},limits:QUERY_LIMITS};
}
function rawFact(analysis:RepositoryAnalysis,fact:Fact):unknown {
 if(fact.kind==="http")return analysis.httpRequests?.find(item=>item.id===fact.rawId);
 if(fact.kind==="database") {const site=analysis.databaseAccess?.sites.find(item=>item.id===fact.rawId);return {site,serverContext:site?.serverContexts.find(item=>item.id===fact.contextId)};}
 return fact.kind==="creation"?analysis.serverResponses?.creations.find(item=>item.id===fact.rawId):analysis.serverResponses?.returns.find(item=>item.id===fact.rawId);
}
/** Select bounded scalar/context evidence, never serialize a raw analysis/Flow subtree. */
function factDetail(analysis:RepositoryAnalysis,fact:Fact,featureId:string,offset=0):Record<string,unknown> {
 const base={id:fact.id,kind:fact.kind,status:fact.status,reason:fact.reason,label:fact.label,location:fact.location,execution:"not-established"};
 if(fact.kind==="http") {
  const request=analysis.httpRequests?.find(item=>item.id===fact.rawId);
  return {...base,method:request?.method,url:request?.url?.slice(0,2048),urlTruncated:(request?.url?.length??0)>2048,path:request?.path?.slice(0,2048),context:contextSummary(request?.context,featureId),
   targetFeatureIds:fact.targetFeatureIds,
   target:request?.target?{entryPoint:request.target.entryPoint,matchKind:request.target.matchKind,parameters:request.target.parameters}:undefined};
 }
 if(fact.kind==="database"){
  const site=analysis.databaseAccess?.sites.find(item=>item.id===fact.rawId),context=site?.serverContexts.find(item=>item.id===fact.contextId);
  return {...base,model:site?.model,operation:site?.operation,operationType:fact.status==="confirmed"?site?.operationType:"unknown",context:contextSummary(site?.context,featureId),
   entryPoint:context?.entryPoint,callPath:context?.callPath.map(step=>({kind:step.kind,filePath:step.location.filePath,startLine:step.location.startLine,targetFunctionId:step.targetFunctionId})),queryResult:"not-analyzed",transactionCommit:"not-established"};
 }
 if(fact.kind==="creation") {
  const creation=analysis.serverResponses?.creations.find(item=>item.id===fact.rawId);
  return {...base,pattern:creation?.pattern,statusCode:creation?.statusCode,statusResolution:creation?.statusResolution,context:contextSummary(creation?.context,featureId),
   dataSources:creation?.dataSources.slice(offset,offset+12).map(source=>{const state=fact.sourceStates?.find(item=>item.sourceId===source.id);return {id:shortId("r",source.id),fieldPath:source.fieldPath,kind:source.kind,
    status:source.kind==="database-result"?state?.status??"unresolved":source.status,reason:source.kind==="database-result"?state?.reason??(state?undefined:"no-confirmed-local-return"):source.reason};}),
   dataSourcesTotal:creation?.dataSources.length,runtimeDelivery:"not-established"};
 }
 const returned=analysis.serverResponses?.returns.find(item=>item.id===fact.rawId);
 return {...base,resolution:fact.status,context:contextSummary(returned?.context,featureId),responseNodeId:fact.responseSiteId?shortId("n",featureId,"creation",fact.responseSiteId,fact.contextId):undefined,
  dataSources:fact.sourceStates?.slice(offset,offset+12).map(item=>({id:shortId("r",item.sourceId),status:item.status,reason:item.reason})),runtimeDelivery:"not-established"};
}
function contextSummary(context:unknown,featureId:string):unknown {
 if(!context||typeof context!=="object")return undefined;
 const item=context as {controlFlowId?:string;statementId?:string;branchPath?:Array<{conditionStatementId:string;branch:string}>;reachability?:string;inUnsupportedRegion?:boolean};
 return {statementId:item.statementId?shortId("c",featureId,item.controlFlowId,item.statementId):undefined,branchPath:item.branchPath?.map(guard=>({conditionId:shortId("c",featureId,item.controlFlowId,guard.conditionStatementId),branch:guard.branch})),reachability:item.reachability,inUnsupportedRegion:item.inUnsupportedRegion};
}
function locationFor(index:FlowIndex,analysis:RepositoryAnalysis,node:StoredNode) {
 const fact=node.factId?index.facts.find(fact=>fact.id===node.factId):undefined;
 if(fact?.location)return fact.location;
 if(node.bindingId){const binding=analysis.reactEventBindings?.find(binding=>binding.id===node.bindingId);if(binding)return {filePath:binding.filePath,startOffset:binding.startOffset,endOffset:binding.endOffset,startLine:binding.line,endLine:binding.endLine,startColumn:binding.column,endColumn:binding.endColumn};}
 const cfg=analysis.functionControlFlows?.find(cfg=>node.sourceIds.includes(cfg.ownerFunctionId));if(cfg)return cfg.functionLocation;
 return undefined;
}
function codeChunk(analysis:RepositoryAnalysis,location:ReturnType<typeof locationFor>,offset:number):CodeChunk|null {
 if(!location)return null;
 const source=analysis.files.find(file=>file.path===location.filePath)?.sourceCode;if(source===undefined)return null;
 const total=location.endOffset-location.startOffset;if(offset<0||offset>total)throw new QueryError("INVALID_OFFSET","Code offset exceeds this node's source range");
 const start=location.startOffset+offset,end=Math.min(location.endOffset,start+QUERY_LIMITS.codeChars);
 return {filePath:location.filePath,startOffset:start,endOffset:end,startLine:source.slice(0,start).split("\n").length,endLine:source.slice(0,end).split("\n").length,
  startColumn:start-source.lastIndexOf("\n",start-1),endColumn:end-source.lastIndexOf("\n",end-1),text:source.slice(start,end),offset,nextOffset:end<location.endOffset?offset+(end-start):null,totalChars:total};
}
export function nodeDetail(index:FlowIndex,analysis:RepositoryAnalysis,id:string,offset=0,codeOffset=0,evidenceIndex?:number):BehaviorNodeDetail {
 const node=requireNode(index,id),fact=node.factId?index.facts.find(fact=>fact.id===node.factId):undefined;
 const facts=fact?[fact]:index.facts.filter(item=>node.sourceIds.includes(item.owner));
 const bindings=index.events.filter(item=>node.sourceIds.includes(item.owner)).flatMap(item=>{const binding=analysis.reactEventBindings?.find(binding=>binding.id===item.bindingId);return binding?[{item,binding}]:[];});
 const evidence:Array<{kind:string;filePath:string;startLine?:number;endLine?:number;startOffset?:number;endOffset?:number;startColumn?:number;endColumn?:number;excerpt?:string}>=node.evidence.map(item=>({kind:item.kind,...item.location}));
 if(fact){
  const raw=rawFact(analysis,fact) as {valueEvidence?:Array<{location:{filePath:string;startLine:number;endLine:number};sourceCode:string}>;serverContext?:{clientEvidence:Array<{kind:string;location:{filePath:string;startLine:number;endLine:number};sourceCode:string}>};constructorEvidence?:Array<{location:{filePath:string;startLine:number;endLine:number};sourceCode:string}>;statusEvidence?:Array<{location:{filePath:string;startLine:number;endLine:number};sourceCode:string}>;evidence?:Array<{location:{filePath:string;startLine:number;endLine:number};sourceCode:string}>;dataSources?:Array<{evidence:Array<{location:{filePath:string;startLine:number;endLine:number};sourceCode:string}>}>};
  for(const item of [...(raw?.valueEvidence??[]),...(raw?.constructorEvidence??[]),...(raw?.statusEvidence??[]),...(raw?.evidence??[]),...(raw?.dataSources??[]).flatMap(item=>item.evidence),...(raw?.serverContext?.clientEvidence??[])]) evidence.push({kind:"kind" in item?String(item.kind):"source",...item.location,excerpt:item.sourceCode.slice(0,300)});
 }
 let codeLocation=locationFor(index,analysis,node);
 if(evidenceIndex!==undefined){
  const selected=evidence[evidenceIndex];if(!selected)throw new QueryError("EVIDENCE_NOT_FOUND","Evidence does not belong to node",404);
  const file=analysis.files.find(file=>file.path===selected.filePath),lines=file?.sourceCode.split("\n");
  if(file&&lines&&!selected.startLine){codeLocation={filePath:selected.filePath,startOffset:0,endOffset:file.sourceCode.length,startLine:1,endLine:lines.length,startColumn:1,endColumn:(lines.at(-1)?.length??0)+1};}
  else if(file&&lines&&selected.startLine&&selected.endLine){
   const startOffset=selected.startOffset??lines.slice(0,selected.startLine-1).reduce((sum,line)=>sum+line.length+1,0),endOffset=selected.endOffset??Math.min(file.sourceCode.length,lines.slice(0,selected.endLine).reduce((sum,line)=>sum+line.length+1,0));
   codeLocation={filePath:selected.filePath,startOffset,endOffset,startLine:selected.startLine,endLine:selected.endLine,startColumn:selected.startColumn??1,endColumn:selected.endColumn??1};
  }
 }
 const cfg=!node.boundary&&node.rawKind!=="artifact"?analysis.functionControlFlows?.find(cfg=>node.sourceIds.includes(cfg.ownerFunctionId)):undefined;
 return {snapshot:index.snapshot,featureId:index.featureId,node:describe(index,node,new Set([id])),code:codeChunk(analysis,codeLocation,codeOffset),sourceCodeNodeIds:node.sourceIds,sourceFeatureId:index.sourceFeatureId,
  evidence:{items:evidence.slice(offset,offset+QUERY_LIMITS.evidencePage).map((item,i)=>({...item,index:offset+i})),total:evidence.length,nextOffset:offset+QUERY_LIMITS.evidencePage<evidence.length?offset+QUERY_LIMITS.evidencePage:null},
  facts:{items:(fact?[fact]:facts.slice(offset,offset+QUERY_LIMITS.factPage)).map(fact=>factDetail(analysis,fact,index.featureId,offset)),total:facts.length,nextOffset:fact&&["creation","return"].includes(fact.kind)?((fact.kind==="creation"?analysis.serverResponses?.creations.find(item=>item.id===fact.rawId)?.dataSources.length:fact.sourceStates?.length)??0)>offset+12?offset+12:null:offset+QUERY_LIMITS.factPage<facts.length?offset+QUERY_LIMITS.factPage:null},
  bindings:{items:bindings.slice(offset,offset+12).map(({item,binding})=>({id:shortId("b",index.featureId,binding.id),event:binding.eventName,element:binding.element.name,mode:binding.mode,status:item.status,reason:item.reason,targetCodeNodeId:binding.targetNodeId,location:{filePath:binding.filePath,startOffset:binding.startOffset,endOffset:binding.endOffset,startLine:binding.line,endLine:binding.endLine}})),total:bindings.length,nextOffset:offset+12<bindings.length?offset+12:null},
  calls:{items:(cfg?.callSites??[]).slice(offset,offset+12).map(site=>({id:shortId("c",index.featureId,cfg!.id,site.id),location:site.location,targetCodeNodeId:site.targetNodeId,resolution:site.targetResolution,context:contextSummary({controlFlowId:cfg!.id,statementId:site.statementId,branchPath:site.branchPath,inUnsupportedRegion:site.inUnsupportedRegion},index.featureId)})),total:cfg?.callSites.length??0,nextOffset:(cfg?.callSites.length??0)>offset+12?offset+12:null},cfg:{available:!!cfg,reason:node.boundary?"entry-boundary":!cfg?"select-owner-function":undefined,statementCount:cfg?.statements.length??0,nodeCount:cfg?.nodes.length??0},reasons:[...index.reasons,...(fact?.reason?[fact.reason]:[])]};
}
export function cfgPage(index:FlowIndex,analysis:RepositoryAnalysis,id:string,offset=0,limit=40):BehaviorCfgResponse {
 const node=requireNode(index,id);if(node.boundary||node.rawKind==="artifact")throw new QueryError("CFG_BOUNDARY","Select this feature's owning function to inspect CFG",409);
 const cfg=analysis.functionControlFlows?.find(cfg=>node.sourceIds.includes(cfg.ownerFunctionId));if(!cfg)throw new QueryError("CFG_NOT_FOUND","No CFG for this node",404);
 if(!validateFunctionControlFlow(cfg,analysis).valid)throw new QueryError("UNSUPPORTED_ANALYSIS","CFG provenance validation failed",422);
 if(offset>cfg.nodes.length)throw new QueryError("INVALID_OFFSET","CFG offset exceeds node count");
 const prefix=cfg.nodes.slice(0,offset+limit),known=new Set(prefix.map(node=>node.id)),page=prefix.slice(offset),fresh=new Set(page.map(node=>node.id));
 const edges=cfg.edges.filter(edge=>known.has(edge.source)&&known.has(edge.target)&&(fresh.has(edge.source)||fresh.has(edge.target)));
 const statements=new Set(page.flatMap(node=>node.statementId?[node.statementId]:[])),sid=(value:string)=>shortId("c",index.featureId,cfg.id,value);
 return {snapshot:index.snapshot,featureId:index.featureId,nodeId:id,semantics:cfg.semantics,runtimeExecution:"not-observed",status:cfg.status,
  nodes:page.map(node=>({id:sid(node.id),kind:node.kind,statementId:node.statementId?sid(node.statementId):undefined,reachability:node.reachability,context:node.context.map(item=>({...item,tryStatementId:sid(item.tryStatementId)}))})),
  edges:edges.map(edge=>({id:sid(edge.id),source:sid(edge.source),target:sid(edge.target),kind:edge.kind,completion:edge.completion,certainty:edge.certainty})),
  statements:cfg.statements.filter(statement=>statements.has(statement.id)).map(statement=>({id:sid(statement.id),kind:statement.kind,location:statement.location,depth:statement.depth,condition:statement.condition?.sourceCode.slice(0,500),branchPath:statement.branchPath.map(guard=>({...guard,conditionStatementId:sid(guard.conditionStatementId)})),unsupportedReason:statement.unsupportedReason})),
  total:{nodes:cfg.nodes.length,edges:cfg.edges.length},offset,nextOffset:offset+limit<cfg.nodes.length?offset+limit:null,hiddenEdges:cfg.edges.filter(edge=>!known.has(edge.source)||!known.has(edge.target)).length,
  limitations:cfg.limitations.map(item=>({code:item.code,message:item.message}))};
}
