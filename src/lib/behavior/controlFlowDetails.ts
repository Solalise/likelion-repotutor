import type { RepositoryAnalysis } from "@/types/analysis";
import type { BehaviorBuildOptions, BehaviorCallContext, BehaviorFlow } from "@/types/behavior";
import type { FunctionControlFlow } from "@/types/controlFlow";
import { unambiguousIndex } from "./evidenceMapper";
import { validateFunctionControlFlow } from "@/lib/controlFlow/validator";

export function contextsForCall(flow: FunctionControlFlow, sourceEdgeIds: string[], targetId: string): BehaviorCallContext[] {
  const statements = new Map(flow.statements.map(item => [item.id, item]));
  return flow.callSites.filter(site => site.targetNodeId === targetId && site.sourceEdgeIds.some(id => sourceEdgeIds.includes(id))).map(site => ({
    controlFlowId: flow.id, callSiteId: site.id, statementId: site.statementId,
    graphNodeIds: flow.nodes.filter(node => node.statementId === site.statementId).map(node => node.id),
    branchPath: site.branchPath.map(guard => ({ ...guard })), reachability: statements.get(site.statementId)!.reachability,
    execution: "not-established",
  }));
}

/** Attach data for expansion without inserting CFG statements into the outer graph. */
export function attachControlFlowDetails(flow: BehaviorFlow, analysis: RepositoryAnalysis, options: BehaviorBuildOptions) {
  if (options.includeControlFlow === false || !analysis.functionControlFlows) return;
  const byOwner = unambiguousIndex(analysis.functionControlFlows, item => item.ownerFunctionId);
  const selected = options.expandFunctionIds ? new Set(options.expandFunctionIds) : undefined;
  const attached = new Map<string, FunctionControlFlow>();
  for (const node of flow.nodes) {
    if (!["screen", "server", "function"].includes(node.kind)) continue;
    const id = node.sourceNodeIds[0], detail = byOwner.get(id);
    if (!detail || (selected && !selected.has(id))) continue;
    if (!validateFunctionControlFlow(detail, analysis).valid) {
      flow.limitations.push({ code: "evidence-unavailable", message: "An invalid function control-flow detail was excluded.", sourceNodeIds: [id] });
      continue;
    }
    node.controlFlowId = detail.id;
    attached.set(detail.id, structuredClone(detail));
  }
  if (!attached.size) return;
  flow.controlFlows = [...attached.values()].sort((a, b) => a.id.localeCompare(b.id));
  const nodes = new Map(flow.nodes.map(node => [node.id, node]));
  for (const edge of flow.edges) {
    if (edge.relation !== "call") continue;
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    const detail = source?.controlFlowId ? attached.get(source.controlFlowId) : undefined;
    if (!detail || !target) continue;
    const contexts = contextsForCall(detail, edge.sourceEdgeIds, target.sourceNodeIds[0]);
    if (contexts.length) edge.callContexts = contexts;
  }
}
