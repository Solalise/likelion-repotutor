import type { RepositoryAnalysis } from "@/types/analysis";
import type { BehaviorFlow } from "@/types/behavior";
import type { BehaviorHttpRequest, HttpRequestSite, HttpValueEvidence } from "@/types/http";
import { behaviorId, canonical, sameEntry, unambiguousIndex } from "./evidenceMapper";
import { validateFunctionControlFlow } from "@/lib/controlFlow/validator";

/** Validate against the supplied AST snapshot, never against network/runtime assumptions. */
function verifiedSite(site: HttpRequestSite, analysis: RepositoryAnalysis): boolean {
  const files = unambiguousIndex(analysis.files, item => item.path);
  function sourceMatches(item: HttpValueEvidence): boolean {
    const source = files.get(item.location.filePath)?.sourceCode;
    const { startOffset, endOffset, startLine, endLine, startColumn, endColumn } = item.location;
    if (source === undefined || startOffset < 0 || endOffset <= startOffset || endOffset > source.length
      || source.slice(startOffset, endOffset) !== item.sourceCode) return false;
    const position = (offset: number) => {
      const prefix = source.slice(0, offset), lines = prefix.split("\n");
      return { line: lines.length, column: lines.at(-1)!.length + 1 };
    };
    const start = position(startOffset), end = position(endOffset);
    return startLine === start.line && startColumn === start.column && endLine === end.line && endColumn === end.column;
  }
  const owner = unambiguousIndex(analysis.files.flatMap(file => file.functions), item => item.id).get(site.ownerFunctionId);
  if (!owner || owner.filePath !== site.location.filePath || site.location.startLine < owner.line || site.location.endLine > owner.endLine
    || !sourceMatches(site) || !site.valueEvidence.every(sourceMatches)
    || site.id !== `http-request:${JSON.stringify([site.location.filePath, site.location.startOffset, site.location.endOffset])}`) return false;
  const cfg = analysis.functionControlFlows?.find(item => item.ownerFunctionId === owner.id);
  const call = cfg?.callSites.find(item => item.location.startOffset === site.location.startOffset && item.location.endOffset === site.location.endOffset && item.sourceCode === site.sourceCode);
  if (site.context) {
    const statement = cfg?.statements.find(item => item.id === call?.statementId);
    if (!cfg || !call || !statement || !validateFunctionControlFlow(cfg, analysis).valid) return false;
    const expected = {
      controlFlowId: cfg.id, callSiteId: call.id, statementId: statement.id,
      graphNodeIds: cfg.nodes.filter(node => node.statementId === statement.id).map(node => node.id),
      branchPath: call.branchPath, reachability: statement.reachability,
      inUnsupportedRegion: call.inUnsupportedRegion, execution: "not-established",
    };
    if (canonical(site.context) !== canonical(expected) || site.contextStatus !== (call.inUnsupportedRegion ? "unsupported-region" : "mapped")) return false;
  } else if (call || site.contextStatus !== "not-available") return false;
  if (site.status === "matched") {
    if (!site.target || site.reason || !site.path || !site.method
      || site.target.entryPoint.kind !== "api" || site.target.entryPoint.method !== site.method
      || !(analysis.entryPoints ?? []).some(entry => sameEntry(entry, site.target!.entryPoint))) return false;
  } else if (site.status !== "unresolved" || !site.reason || site.target) return false;
  return true;
}

/** HTTP boundaries form an additive relation layer; legacy graph/CFG edges are untouched. */
export function projectHttpRequests(flow: BehaviorFlow, analysis: RepositoryAnalysis): BehaviorHttpRequest[] {
  if (flow.status === "unavailable") return [];
  const owners = new Map(flow.nodes.filter(node => ["screen", "function", "server"].includes(node.kind)).map(node => [node.sourceNodeIds[0], node.id]));
  return [...unambiguousIndex(analysis.httpRequests ?? [], site => site.id).values()]
    .filter(site => owners.has(site.ownerFunctionId) && verifiedSite(site, analysis))
    .sort((a, b) => a.id.localeCompare(b.id)).map(site => {
      const target = site.status === "matched" ? site.target : undefined;
      const serverCfg = target && analysis.functionControlFlows?.find(cfg => cfg.ownerFunctionId === target.entryPoint.nodeId);
      return {
        request: structuredClone(site), ownerBehaviorNodeId: owners.get(site.ownerFunctionId)!,
        boundary: target ? {
          id: behaviorId("http-boundary", flow.id, site.id), relation: "http-request-to-entry", semantics: "http-boundary", confidence: "confirmed",
          requestSiteId: site.id, serverEntryPoint: { ...target.entryPoint },
          serverFlowId: behaviorId("flow", analysis.repository, target.entryPoint),
          serverControlFlowId: serverCfg && validateFunctionControlFlow(serverCfg, analysis).valid ? serverCfg.id : undefined,
          runtimeTransfer: "not-observed", executionOrder: "not-established", response: "not-analyzed", exceptionPropagation: "not-modeled",
        } : undefined,
      };
    });
}
