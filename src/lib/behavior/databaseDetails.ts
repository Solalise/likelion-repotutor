import type { RepositoryAnalysis } from "@/types/analysis";
import type { BehaviorFlow } from "@/types/behavior";
import type { BehaviorDatabaseAccess, DatabaseAccessSite, DatabaseEvidence, DatabaseServerContext } from "@/types/database";
import type { ControlFlowLocation } from "@/types/controlFlow";
import { canonical, createEvidenceMapper, edgeMatchesRelation, sameEntry, unambiguousIndex } from "./evidenceMapper";
import { validateFunctionControlFlow } from "@/lib/controlFlow/validator";

/** Pure snapshot validation; no database connections, result inference or AST re-parsing. */
export function projectDatabaseAccesses(flow: BehaviorFlow, analysis: RepositoryAnalysis): BehaviorDatabaseAccess[] {
  if (flow.status === "unavailable" || flow.entryPoint.kind !== "api" || !analysis.databaseAccess?.sites.length) return [];
  const mapper = createEvidenceMapper(analysis);
  const sites = unambiguousIndex(analysis.databaseAccess?.sites ?? [], site => site.id);
  const cfgs = unambiguousIndex(analysis.functionControlFlows ?? [], cfg => cfg.ownerFunctionId);
  const validCfgs = new Set([...cfgs.values()].filter(cfg => validateFunctionControlFlow(cfg, analysis).valid).map(cfg => cfg.id));
  const owners = new Map(flow.nodes.filter(node => ["screen", "function", "server"].includes(node.kind)).map(node => [node.sourceNodeIds[0], node.id]));
  function sourceMatches(item: { location: ControlFlowLocation; sourceCode: string }): boolean {
    const source = mapper.files.get(item.location.filePath)?.sourceCode;
    const { startOffset, endOffset, startLine, endLine, startColumn, endColumn } = item.location;
    return source !== undefined && Number.isInteger(startOffset) && Number.isInteger(endOffset) && startOffset >= 0 && endOffset > startOffset && endOffset <= source.length
      && source.slice(startOffset,endOffset) === item.sourceCode
      && source.slice(0,startOffset).split("\n").length === startLine && source.slice(0,endOffset).split("\n").length === endLine
      && startOffset - source.lastIndexOf("\n",startOffset-1) === startColumn && endOffset - source.lastIndexOf("\n",endOffset-1) === endColumn;
  }
  function expectedContext(owner: string, item: {location: ControlFlowLocation; sourceCode:string}) {
    const cfg = cfgs.get(owner);
    if (!cfg || !validCfgs.has(cfg.id)) return;
    const call = cfg.callSites.find(call => call.location.filePath === item.location.filePath
      && call.location.startOffset === item.location.startOffset && call.location.endOffset === item.location.endOffset && call.sourceCode === item.sourceCode);
    const statement = cfg.statements.find(statement => statement.id === call?.statementId);
    if (!call || !statement) return;
    return {controlFlowId:cfg.id,callSiteId:call.id,statementId:statement.id,
      graphNodeIds:cfg.nodes.filter(node => node.statementId === statement.id).map(node => node.id),
      branchPath:call.branchPath,reachability:statement.reachability,inUnsupportedRegion:call.inUnsupportedRegion,execution:"not-established"};
  }
  function validContext(site: DatabaseAccessSite, server: DatabaseServerContext): boolean {
    if (!sameEntry(server.entryPoint,flow.entryPoint) || !mapper.entryPoint(server.entryPoint)) return false;
    if (server.id !== `database-context:${JSON.stringify([site.id,server.entryPoint,server.callPath.map(step => [step.kind,step.location.filePath,step.location.startOffset])])}`) return false;
    let owner = server.entryPoint.nodeId;
    for (const [index, step] of server.callPath.entries()) {
      if (step.sourceFunctionId !== owner || !mapper.declaration(step.targetFunctionId) || !sourceMatches(step)
        || canonical(step.context) !== canonical(expectedContext(owner,step))) return false;
      if (step.kind === "call") {
        const cfgCall = cfgs.get(owner)?.callSites.find(item => item.id === step.context?.callSiteId);
        if (!cfgCall || cfgCall.targetNodeId !== step.targetFunctionId || cfgCall.targetResolution !== "resolved") return false;
        const relation = mapper.functions.get(owner)?.relations?.find(item => item.relation === "call" && item.targetId === step.targetFunctionId
          && item.line === step.location.startLine && item.confidence === "confirmed" && item.evidence === step.sourceCode.replace(/\s+/g," ").slice(0,240));
        if (step.sourceEdgeIds.some(id => {
          const edge = mapper.edges.get(id);
          return !relation || !edge || edge.confidence !== "confirmed" || !edgeMatchesRelation(edge,owner,relation);
        })) return false;
      } else if (step.kind === "transaction-callback") {
        const transaction = step.transactionSiteId ? sites.get(step.transactionSiteId) : undefined;
        if (step.sourceEdgeIds.length || !transaction || transaction.operation !== "$transaction"
          || transaction.ownerFunctionId !== owner || canonical(transaction.location) !== canonical(step.location)
          || mapper.functions.get(step.targetFunctionId)?.parentId !== owner
          || !transaction.serverContexts.some(candidate => candidate.status === "confirmed" && sameEntry(candidate.entryPoint,server.entryPoint)
            && canonical(candidate.callPath) === canonical(server.callPath.slice(0,index)))) return false;
      } else return false;
      owner = step.targetFunctionId;
    }
    const evidenceKinds = new Set<DatabaseEvidence["kind"]>(["constructor-import","client-construction","alias","factory-return","argument-binding","transaction-callback"]);
    if (owner !== site.ownerFunctionId || !server.clientEvidence.every(item => evidenceKinds.has(item.kind) && sourceMatches(item))) return false;
    return server.status === "confirmed" ? !server.reason && server.clientEvidence.some(item => item.kind === "constructor-import")
      && server.clientEvidence.some(item => item.kind === "client-construction") : server.status === "unresolved" && Boolean(server.reason);
  }
  const projected: BehaviorDatabaseAccess[] = [];
  for (const site of sites.values()) {
    if (!mapper.declaration(site.ownerFunctionId) || !sourceMatches(site)
      || site.id !== `database-access:${JSON.stringify([site.location.filePath,site.location.startOffset,site.location.endOffset])}`) continue;
    const expected = expectedContext(site.ownerFunctionId,site);
    if (canonical(site.context) !== canonical(expected) || site.contextStatus !== (expected ? expected.inUnsupportedRegion ? "unsupported-region" : "mapped" : "not-available")) continue;
    for (const server of unambiguousIndex(site.serverContexts,item => item.id).values()) {
      if (!validContext(site,server)) continue;
      const { serverContexts: _contexts, ...description } = site;
      void _contexts;
      projected.push({site:{...structuredClone(description),status:server.status,reason:server.reason,operationType:server.status === "confirmed" ? site.operationType : "unknown"},
        serverContext:structuredClone(server),ownerBehaviorNodeId:owners.get(site.ownerFunctionId),semantics:"static-database-access",
        runtimeExecution:"not-observed",queryResult:"not-analyzed",transactionCommit:"not-established"});
    }
  }
  return projected.sort((a,b) => a.serverContext.id.localeCompare(b.serverContext.id));
}
