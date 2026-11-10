import type { RepositoryAnalysis, RepositoryEntryPoint } from "@/types/analysis";
import type { BehaviorFlow } from "@/types/behavior";
import { discoverRepositoryFeatures } from "@/lib/features/featureDiscovery";

export type ProbeKind="entry"|"feature"|"component"|"event"|"call"|"cfg"|"http"|"db"|"creation"|"return"|"lineage"|"custom-event"|"unrelated"|"runtime";
export interface GoldRelation {
 id:string; truth:"positive"|"negative"|"unknown"; stage:string; kind:ProbeKind;
 file?:string; anchor?:string; occurrence?:number; route?:string; method?:string;
 target?:string; branch?:"true"|"false"; unsupported?:boolean; field?:string[]; databaseAnchor?:string; note:string;
}
export interface Observation {state:"confirmed"|"unresolved"|"absent"; ids:string[]; reason?:string; rawIds?:string[]; wrongIds?:string[]}
export interface AuditRow extends GoldRelation {observation:Observation; outcome:"correct"|"missing"|"false-confirmed"|"unresolved"|"unknown-confirmation"|"correct-rejection"; location?:{filePath:string;line:number;offset:number}}
export interface AuditInput {analysis:RepositoryAnalysis; flows:BehaviorFlow[]; entries:RepositoryEntryPoint[]}

export function observe(input:AuditInput,gold:GoldRelation):{observation:Observation;location?:AuditRow["location"]} {
 const {analysis,flows}=input,source=analysis.files.find(file=>file.path===gold.file)?.sourceCode;
 let offset:number|undefined;
 if(gold.anchor) {
  if(source===undefined) throw Error(`Missing oracle file ${gold.file}`);
  let found=-1;
  for(let i=0;i<=(gold.occurrence??0);i++) {found=source.indexOf(gold.anchor,found+1);if(found<0) throw Error(`Stale manual anchor ${gold.id}: ${gold.anchor}`);}
  offset=found;
 }
 const location=offset!==undefined?{filePath:gold.file!,line:source!.slice(0,offset).split("\n").length,offset}:undefined;
 const at=(item:{location:{filePath:string;startOffset:number;endOffset:number}})=>item.location.filePath===gold.file&&offset!==undefined&&item.location.startOffset<=offset&&item.location.endOffset>offset;
 const named=(id:string|undefined)=>id&&analysis.nodes.find(node=>node.id===id)?.name===gold.target;
 const confirmed=(ids:string[],rawIds=ids):Observation=>({state:ids.length?"confirmed":"absent",ids,rawIds});
 const finding=(rawIds:string[],ids:string[],reason?:string):Observation=>({state:ids.length?"confirmed":rawIds.length?"unresolved":"absent",ids,rawIds,reason:ids.length?undefined:reason??"extracted-but-not-projected"});
 let observation:Observation;
 switch(gold.kind) {
  case "entry": {
   const candidates=input.entries.filter(entry=>entry.routePath===gold.route&&entry.method===gold.method);
   observation=confirmed(candidates.filter(entry=>!gold.target||named(entry.nodeId)).map(entry=>entry.nodeId));
   observation.wrongIds=candidates.filter(entry=>gold.target&&!named(entry.nodeId)).map(entry=>entry.nodeId);break;
  }
  case "feature": {
   const features=discoverRepositoryFeatures(analysis);observation=confirmed([...features.primary,...features.limited].filter(feature=>feature.routePath===gold.route&&feature.httpMethod===gold.method).map(feature=>feature.id));break;
  }
  case "component":case "call": {
   const sites=(analysis.functionControlFlows??[]).flatMap(cfg=>cfg.callSites).filter(site=>at(site)&&named(site.targetNodeId));
   const edges=analysis.edges.filter(edge=>edge.relation===gold.kind&&edge.confidence==="confirmed"&&named(edge.target)&&analysis.nodes.find(node=>node.id===edge.source)?.filePath===gold.file
     &&edge.line===location?.line);
   const ids=flows.flatMap(flow=>flow.edges.filter(edge=>edge.relation===gold.kind&&edge.sourceEdgeIds.some(id=>edges.some(raw=>raw.id===id))
    &&flow.nodes.find(node=>node.id===edge.target)?.sourceNodeIds.some(id=>named(id))).map(edge=>edge.id));
   observation=finding([...edges.map(edge=>edge.id),...sites.map(site=>site.id)],ids,sites.length?"cfg-call-resolved-but-outer-edge-missing":"no-matching-call-edge");
   observation.wrongIds=flows.flatMap(flow=>flow.edges.filter(edge=>edge.relation===gold.kind&&edge.sourceEdgeIds.some(id=>edges.some(raw=>raw.id===id))
    &&!flow.nodes.find(node=>node.id===edge.target)?.sourceNodeIds.some(id=>named(id))).map(edge=>edge.id));
   if(gold.kind==="call") observation.wrongIds.push(...(analysis.functionControlFlows??[]).flatMap(cfg=>cfg.callSites)
    .filter(site=>at(site)&&site.location.startOffset===offset&&site.targetResolution==="resolved"&&!named(site.targetNodeId))
    .flatMap(site=>flows.flatMap(flow=>flow.edges.filter(edge=>edge.relation==="call"&&edge.sourceEdgeIds.some(id=>site.sourceEdgeIds.includes(id))).map(edge=>edge.id))));
   break;
  }
  case "event":case "custom-event": {
   const raw=(analysis.reactEventBindings??[]).filter(binding=>binding.filePath===gold.file&&offset!==undefined&&binding.startOffset<=offset&&binding.endOffset>offset);
   const good=raw.filter(binding=>binding.status==="confirmed"&&(gold.kind==="custom-event"||named(binding.targetNodeId)
    ||binding.mode==="inline"&&analysis.files.flatMap(file=>file.functions).some(fn=>fn.id===binding.targetNodeId&&fn.sourceCode===binding.handlerExpression)));
   const ids=flows.flatMap(flow=>(flow.eventBindings??[]).filter(item=>good.some(binding=>binding.id===item.bindingId)&&item.status==="projected").map(item=>item.bindingId));
   const projected=flows.flatMap(flow=>flow.eventBindings??[]).filter(item=>raw.some(binding=>binding.id===item.bindingId));
   observation=finding(raw.map(binding=>binding.id),ids,projected.map(item=>item.reason??item.status).join(",")||raw.map(item=>item.reason??`${item.status}-raw-only`).join(","));break;
  }
  case "cfg": {
   const statements=(analysis.functionControlFlows??[]).flatMap(cfg=>cfg.statements).filter(at);
   const calls=(analysis.functionControlFlows??[]).flatMap(cfg=>cfg.callSites).filter(at);
   const matched=gold.unsupported?statements.filter(item=>item.kind==="unsupported"):gold.branch?calls.filter(item=>item.branchPath.some(path=>path.branch===gold.branch)):calls;
   observation=confirmed(matched.map(item=>item.id));break;
  }
  case "http": {
   const raw=(analysis.httpRequests??[]).filter(at),ids=flows.flatMap(flow=>(flow.httpRequests??[]).filter(item=>raw.some(site=>site.id===item.request.id)&&item.boundary
     &&(!gold.route||item.boundary.serverEntryPoint.routePath===gold.route)&&(!gold.method||item.boundary.serverEntryPoint.method===gold.method)).map(item=>item.boundary!.id));
   observation=finding(raw.map(item=>item.id),ids,raw.map(item=>item.reason??item.status).join(","));
   observation.wrongIds=flows.flatMap(flow=>(flow.httpRequests??[]).filter(item=>raw.some(site=>site.id===item.request.id)&&item.boundary
    &&((gold.route&&item.boundary.serverEntryPoint.routePath!==gold.route)||(gold.method&&item.boundary.serverEntryPoint.method!==gold.method))).map(item=>item.boundary!.id));break;
  }
  case "db": {
   const raw=(analysis.databaseAccess?.sites??[]).filter(at),items=flows.flatMap(flow=>flow.databaseAccesses??[]).filter(item=>raw.some(site=>site.id===item.site.id));
   observation=finding(raw.map(item=>item.id),items.filter(item=>item.site.status==="confirmed").map(item=>item.serverContext.id),items.map(item=>item.serverContext.reason??item.site.status).join(",")||raw.map(item=>item.reason).join(","));break;
  }
  case "creation": {
   const raw=(analysis.serverResponses?.creations??[]).filter(at);
   observation=finding(raw.map(site=>site.id),flows.flatMap(flow=>(flow.serverResponses?.creations??[]).filter(item=>raw.some(site=>site.id===item.siteId&&site.constructorResolution==="confirmed")).map(item=>item.siteId)));break;
  }
  case "return": {
   const raw=(analysis.serverResponses?.returns??[]).filter(at),items=flows.flatMap(flow=>flow.serverResponses?.returns??[]).filter(item=>raw.some(site=>site.id===item.returnSiteId));
   const matched=items.filter(item=>gold.target==="local"?item.kind==="helper-local-return":item.kind==="entry-return-reference");
   observation=finding(raw.map(site=>site.id),matched.map(item=>item.returnSiteId),raw.map(item=>item.reason??"helper-local-only").join(","));break;
  }
  case "lineage": {
   const raw=(analysis.serverResponses?.creations??[]).filter(at).flatMap(site=>site.dataSources).filter(item=>JSON.stringify(item.fieldPath)===JSON.stringify(gold.field??[]));
   const items=flows.flatMap(flow=>flow.serverResponses?.returns??[]).flatMap(item=>item.dataSources).filter(item=>raw.some(source=>source.id===item.sourceId));
   const expectedOffset=gold.databaseAnchor?source?.indexOf(gold.databaseAnchor):-1;
   if(gold.databaseAnchor&&expectedOffset===-1) throw Error(`Stale DB target anchor ${gold.id}`);
   const expectedDb=gold.databaseAnchor?(analysis.databaseAccess?.sites??[]).find(site=>site.location.filePath===gold.file&&site.location.startOffset<=expectedOffset!&&site.location.endOffset>expectedOffset!):undefined;
   const correct=items.filter(item=>item.status==="confirmed"&&item.databaseContextId&&(!gold.databaseAnchor||raw.some(source=>source.id===item.sourceId&&source.databaseSiteId===expectedDb?.id)));
   observation=finding(raw.map(source=>source.id),correct.map(item=>item.sourceId),items.map(item=>item.reason).join(",")||raw.map(item=>item.reason).join(",")||"wrapper-body-not-propagated");
   observation.wrongIds=items.filter(item=>item.status==="confirmed"&&item.databaseContextId&&!correct.includes(item)).map(item=>item.sourceId);break;
  }
  case "unrelated": observation=confirmed(flows.flatMap(flow=>flow.nodes.filter(node=>node.label===gold.target).map(node=>node.id)));break;
  case "runtime": observation=confirmed(flows.flatMap(flow=>flow.edges.filter(edge=>edge.semantics==="runtime-observed"||edge.executionOrder==="established").map(edge=>edge.id)));break;
 }
 return {observation,location};
}
export function scoreRows(gold:GoldRelation[],input:AuditInput):AuditRow[] {
 return gold.map(item=>{const result=observe(input,item),state=result.observation.state;
  const outcome:AuditRow["outcome"]=item.truth==="unknown"?(state==="confirmed"?"unknown-confirmation":"unresolved")
   :item.truth==="negative"?(state==="confirmed"?"false-confirmed":"correct-rejection")
   :result.observation.wrongIds?.length?"false-confirmed":state==="confirmed"?"correct":state==="unresolved"?"unresolved":"missing";
  return {...item,...result,outcome};});
}
export function metrics(rows:AuditRow[]) {
 const count=(outcome:AuditRow["outcome"])=>rows.filter(row=>row.outcome===outcome).length;
 const tp=count("correct"),fp=count("false-confirmed"),positives=rows.filter(row=>row.truth==="positive").length;
 return {auditedRelations:rows.length,positiveTruth:positives,negativeTruth:rows.filter(row=>row.truth==="negative").length,unknownTruth:rows.filter(row=>row.truth==="unknown").length,
  correct:tp,missing:count("missing"),unresolved:count("unresolved"),falseConfirmed:fp,unknownConfirmations:count("unknown-confirmation"),correctRejections:count("correct-rejection"),
  unresolvedPositive:rows.filter(row=>row.truth==="positive"&&row.outcome==="unresolved").length,notConfirmedPositive:positives-tp,
  samplePrecision:tp+fp?tp/(tp+fp):null,sampleRecall:positives?tp/positives:null,
  scope:"Only predeclared oracle rows, not all output edges or repository-wide accuracy. Unknown truth is excluded; unresolved known positives reduce recall."};
}
