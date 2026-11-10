import type { RepositoryAnalysis } from "@/types/analysis";
import type { BehaviorFlow } from "@/types/behavior";
import type { BehaviorServerResponses, ResponseContext, ResponseCreation, ResponseServerContext } from "@/types/response";
import type { HttpValueEvidence } from "@/types/http";
import { canonical, createEvidenceMapper, sameEntry, unambiguousIndex } from "./evidenceMapper";
import { validateFunctionControlFlow } from "@/lib/controlFlow/validator";
import { projectDatabaseAccesses } from "./databaseDetails";

/** Only references existing response/CFG/DB facts. Does not compose helper return values. */
export function projectServerResponses(flow:BehaviorFlow,analysis:RepositoryAnalysis):BehaviorServerResponses {
  const output:BehaviorServerResponses={semantics:"static-response-references",runtimeDelivery:"not-established",creations:[],returns:[]};
  if(flow.status==="unavailable"||flow.entryPoint.kind!=="api"||!analysis.serverResponses) return output;
  const mapper=createEvidenceMapper(analysis),cfgs=unambiguousIndex(analysis.functionControlFlows??[],cfg=>cfg.ownerFunctionId);
  const cfgValid=new Map<string,boolean>();
  function validCfg(owner:string):boolean {
    if(!cfgValid.has(owner)) {const cfg=cfgs.get(owner);cfgValid.set(owner,Boolean(cfg&&validateFunctionControlFlow(cfg,analysis).valid));}
    return cfgValid.get(owner)!;
  }
  function sourceMatches(item:HttpValueEvidence):boolean {
    const source=mapper.files.get(item.location.filePath)?.sourceCode,range=item.location;
    return source!==undefined&&Number.isInteger(range.startOffset)&&Number.isInteger(range.endOffset)&&range.startOffset>=0&&range.endOffset>range.startOffset&&range.endOffset<=source.length
      &&source.slice(range.startOffset,range.endOffset)===item.sourceCode
      &&source.slice(0,range.startOffset).split("\n").length===range.startLine&&source.slice(0,range.endOffset).split("\n").length===range.endLine
      &&range.startOffset-source.lastIndexOf("\n",range.startOffset-1)===range.startColumn&&range.endOffset-source.lastIndexOf("\n",range.endOffset-1)===range.endColumn;
  }
  function contextMatches(owner:string,item:HttpValueEvidence,actual:ResponseContext|undefined):boolean {
    const cfg=cfgs.get(owner);
    if(!cfg||!validCfg(owner)) return false;
    const statement=cfg.statements.filter(statement=>statement.location.startOffset<=item.location.startOffset&&statement.location.endOffset>=item.location.endOffset)
      .sort((a,b)=>(a.location.endOffset-a.location.startOffset)-(b.location.endOffset-b.location.startOffset))[0];
    if(!statement) return actual===undefined;
    const call=cfg.callSites.find(call=>call.location.startOffset===item.location.startOffset&&call.location.endOffset===item.location.endOffset);
    return canonical(actual)===canonical({controlFlowId:cfg.id,statementId:statement.id,callSiteId:call?.id,
      graphNodeIds:cfg.nodes.filter(node=>node.statementId===statement.id).map(node=>node.id),branchPath:statement.branchPath,reachability:statement.reachability,
      inUnsupportedRegion:statement.kind==="unsupported"||call?.inUnsupportedRegion===true,execution:"not-established"});
  }
  function validServer(context:ResponseServerContext):boolean {
    if(!sameEntry(context.entryPoint,flow.entryPoint)||!mapper.entryPoint(context.entryPoint)
      ||context.id!==`response-server:${JSON.stringify([context.entryPoint,context.ownerFunctionId,context.callSiteIds])}`) return false;
    let owner=context.entryPoint.nodeId;
    for(const id of context.callSiteIds) {
      const call=validCfg(owner)?cfgs.get(owner)?.callSites.find(call=>call.id===id):undefined;
      if(!call||call.targetResolution!=="resolved"||!call.targetNodeId||!mapper.declaration(call.targetNodeId)) return false;
      owner=call.targetNodeId;
    }
    return owner===context.ownerFunctionId;
  }
  const creations=unambiguousIndex(analysis.serverResponses.creations,site=>site.id);
  const contexts=[...unambiguousIndex(analysis.serverResponses.serverContexts,item=>item.id).values()].filter(validServer);
  const relevantOwners=new Set(contexts.map(item=>item.ownerFunctionId));
  const validCreations=new Map<string,ResponseCreation>();
  for(const [id,site] of creations) {
    if(!relevantOwners.has(site.ownerFunctionId)||!mapper.declaration(site.ownerFunctionId)||!sourceMatches(site)||!site.constructorEvidence.every(sourceMatches)||!site.statusEvidence.every(sourceMatches)
      ||!contextMatches(site.ownerFunctionId,site,site.context)||id!==`response-creation:${JSON.stringify([site.location.filePath,site.location.startOffset,site.location.endOffset])}`
      ||site.dataSources.some(source=>!sourceMatches(source.expression)||!source.evidence.every(sourceMatches))) continue;
    validCreations.set(id,site);
  }
  const returns=unambiguousIndex(analysis.serverResponses.returns,site=>site.id);
  const db=[...validCreations.values()].some(site=>site.dataSources.some(source=>source.kind==="database-result"))?projectDatabaseAccesses(flow,analysis):[];
  for(const context of contexts) {
    const localReturns=[...returns.values()].filter(item=>item.ownerFunctionId===context.ownerFunctionId&&sourceMatches(item)&&item.evidence.every(sourceMatches)
      &&contextMatches(item.ownerFunctionId,item,item.context)&&item.id===`response-return:${JSON.stringify([item.location.filePath,item.location.startOffset,item.location.endOffset])}`);
    for(const site of validCreations.values()) if(site.ownerFunctionId===context.ownerFunctionId) output.creations.push({siteId:site.id,serverContextId:context.id,
      returnedBy:localReturns.filter(item=>item.resolution==="confirmed"&&item.responseSiteId===site.id&&site.constructorResolution==="confirmed").map(item=>item.id).sort()});
    for(const item of localReturns) {
      const creation=item.responseSiteId?validCreations.get(item.responseSiteId):undefined;
      const confirmed=item.resolution==="confirmed"&&creation?.constructorResolution==="confirmed"&&creation.ownerFunctionId===item.ownerFunctionId;
      output.returns.push({returnSiteId:item.id,serverContextId:context.id,
        kind:!confirmed?"unresolved-return":context.ownerFunctionId===context.entryPoint.nodeId?"entry-return-reference":"helper-local-return",
        responseSiteId:confirmed?creation.id:undefined,
        dataSources:confirmed?creation.dataSources.map(source=>{
          if(source.kind!=="database-result") return {sourceId:source.id,status:source.status,reason:source.reason};
          const match=db.find(access=>access.site.id===source.databaseSiteId&&access.site.ownerFunctionId===item.ownerFunctionId&&access.serverContext.status==="confirmed"
            &&canonical(access.serverContext.callPath.map(step=>step.context?.callSiteId))===canonical(context.callSiteIds));
          return match?{sourceId:source.id,status:"confirmed" as const,databaseContextId:match.serverContext.id}
            :{sourceId:source.id,status:"unresolved" as const,reason:"database-source-unverified-in-server-context"};
        }):[]});
    }
  }
  output.creations.sort((a,b)=>canonical(a).localeCompare(canonical(b)));output.returns.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  return output;
}
