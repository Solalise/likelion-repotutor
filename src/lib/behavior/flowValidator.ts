import type { RepositoryAnalysis } from "@/types/analysis";
import type { BehaviorEdge, BehaviorEvidence, BehaviorFlow, BehaviorNode, BehaviorValidationResult } from "@/types/behavior";
import { behaviorId, canonical, createEvidenceMapper, sameEntry } from "./evidenceMapper";
import { validateFunctionControlFlow } from "@/lib/controlFlow/validator";
import { contextsForCall } from "./controlFlowDetails";
import { projectHttpRequests } from "./httpDetails";
import { projectDatabaseAccesses } from "./databaseDetails";
import { projectServerResponses } from "./responseDetails";

/** Schema-v1 validator: validates provenance, not runtime behavior or a new AST interpretation. */
export function validateBehaviorFlow(flow: BehaviorFlow, analysis: RepositoryAnalysis): BehaviorValidationResult {
  const errors: BehaviorValidationResult["errors"] = [];
  const fail = (code: string, id?: string) => errors.push({ code, id, message: `Invalid behavior projection: ${code}.` });
  const mapper = createEvidenceMapper(analysis);
  const index = <T extends { id: string }>(items: T[]) => {
    const map = new Map<string, T>();
    for (const item of items) { if (map.has(item.id)) fail("duplicate-id", item.id); map.set(item.id, item); }
    return map;
  };
  const nodes = index(flow.nodes), evidence = index(flow.evidence);
  index(flow.edges); index(flow.unresolved);
  const equalIds = (a: string[], b: string[]) => canonical([...new Set(a)].sort()) === canonical([...new Set(b)].sort());
  const references = (ids: string[], id: string) => {
    if (ids.some(key => !evidence.has(key))) fail("missing-evidence", id);
  };
  if (flow.schemaVersion !== 1 || flow.repository !== analysis.repository || flow.commitSha !== analysis.collection?.commitSha
    || flow.id !== behaviorId("flow", analysis.repository, flow.entryPoint)
    || flow.semantics !== "static-code-relations" || flow.executionOrder !== "not-established") fail("invalid-flow-contract", flow.id);
  if (flow.status === "unavailable") {
    if (flow.nodes.length || flow.edges.length || flow.evidence.length || flow.unresolved.length || flow.entryNodeId || flow.eventBindings?.length || flow.controlFlows?.length || flow.httpRequests?.length || flow.databaseAccesses?.length || flow.serverResponses?.creations.length || flow.serverResponses?.returns.length) fail("unavailable-flow-has-data", flow.id);
    return { valid: errors.length === 0, errors };
  }
  if (flow.status !== "partial" || !flow.entryNodeId || !nodes.has(flow.entryNodeId)
    || !(analysis.entryPoints ?? []).some(entry => sameEntry(entry, flow.entryPoint))) fail("unverified-entry", flow.id);
  if (flow.entryNodeId && !nodes.get(flow.entryNodeId)?.sourceNodeIds.includes(flow.entryPoint.nodeId)) fail("entry-node-mismatch", flow.entryNodeId);

  for (const item of flow.evidence) {
    let expected: BehaviorEvidence | undefined;
    if (item.origin.kind === "declaration") expected = mapper.declaration(item.origin.nodeId);
    else if (item.origin.kind === "entry-point") expected = mapper.entryPoint(item.origin.entryPoint);
    else if (item.origin.kind === "relation") expected = mapper.relation(item.origin.sourceId, item.origin.relation, item.sourceEdgeIds);
    else if (item.origin.kind === "event-binding") expected = mapper.eventBinding(item.origin.binding.id);
    if (!expected || canonical(expected) !== canonical(item)) fail("unverified-evidence", item.id);
  }

  function nodeFacts(node: BehaviorNode): BehaviorEvidence[] {
    return node.evidenceIds.flatMap(id => evidence.get(id) ?? []);
  }
  for (const node of flow.nodes) {
    references(node.evidenceIds, node.id);
    const facts = nodeFacts(node);
    if (node.confidence !== "confirmed" || !facts.length || facts.some(item => item.confidence !== "confirmed")
      || node.sourceNodeIds.length !== 1 || !mapper.nodes.has(node.sourceNodeIds[0])) fail("unverified-node", node.id);
    if (node.kind === "event") {
      const fact = facts.length === 1 ? facts[0] : undefined;
      const binding = fact?.origin.kind === "event-binding" ? fact.origin.binding : undefined;
      if (!binding || binding.status !== "confirmed" || binding.ownerNodeId !== node.sourceNodeIds[0]
        || node.id !== behaviorId("event", flow.id, binding.id) || node.eventBindingId !== binding.id
        || node.label !== `<${binding.element.name}> ${binding.eventName} 바인딩` || node.sourceEdgeIds.length || node.request) fail("unverified-event", node.id);
      continue;
    }
    if (node.eventBindingId) fail("event-provenance-on-non-event", node.id);
    if (node.kind === "api-request") {
      const fact = facts.length === 1 ? facts[0] : undefined;
      const origin = fact?.origin;
      if (!fact || origin?.kind !== "relation" || origin.relation.relation !== "api" || !origin.relation.targetId
        || !origin.relation.requestPath || !origin.relation.requestMethod
        || origin.sourceId !== node.sourceNodeIds[0] || !fact.sourceEdgeIds.length
        || !equalIds(fact.sourceEdgeIds, node.sourceEdgeIds)
        || node.id !== behaviorId("request", flow.id, fact.id)
        || node.request?.path !== origin.relation.requestPath || node.request?.method !== origin.relation.requestMethod
        || node.label !== `${origin.relation.requestMethod} ${origin.relation.requestPath}`) fail("unverified-api-request", node.id);
      continue;
    }
    if (!["screen", "function", "server"].includes(node.kind) || node.request || node.sourceEdgeIds.length
      || node.id !== behaviorId("node", flow.id, node.sourceNodeIds[0]) || node.label !== mapper.nodes.get(node.sourceNodeIds[0])?.name
      || !facts.some(item => item.origin.kind === "declaration" && item.origin.nodeId === node.sourceNodeIds[0])) fail("unsupported-node-role", node.id);
    if (node.kind === "screen" || node.kind === "server") {
      const kind = node.kind === "screen" ? "page" : "api";
      if (!facts.some(item => item.origin.kind === "entry-point" && item.origin.entryPoint.kind === kind
        && item.origin.entryPoint.nodeId === node.sourceNodeIds[0])) fail("unverified-node-role", node.id);
      if (node.kind === "screen" && node.id !== flow.entryNodeId) fail("page-boundary-crossed", node.id);
    }
  }

  function validatesEdgeFact(edge: BehaviorEdge, fact: BehaviorEvidence, source: BehaviorNode, target: BehaviorNode): boolean {
    if (fact.origin.kind === "event-binding") {
      const binding = fact.origin.binding;
      if (fact.confidence !== "confirmed" || binding.status !== "confirmed" || edge.sourceEdgeIds.length) return false;
      if (edge.relation === "event-binding") return source.kind !== "event" && source.kind !== "api-request"
        && source.sourceNodeIds[0] === binding.ownerNodeId && target.kind === "event" && target.eventBindingId === binding.id;
      return edge.relation === "event-handler" && source.kind === "event" && source.eventBindingId === binding.id
        && target.kind !== "event" && target.kind !== "api-request" && target.sourceNodeIds[0] === binding.targetNodeId
        && (target.id === flow.entryNodeId || !(analysis.entryPoints ?? []).some(entry => entry.nodeId === binding.targetNodeId));
    }
    if (fact.origin.kind !== "relation" || fact.confidence !== "confirmed" || !fact.sourceEdgeIds.length
      || fact.sourceEdgeIds.some(id => mapper.edges.get(id)?.confidence !== "confirmed")) return false;
    const { sourceId, relation } = fact.origin;
    if (relation.relation === "api") {
      const request = edge.relation === "api-request" ? target : source;
      const endpoint = edge.relation === "api-route" ? target : undefined;
      if (request.kind !== "api-request" || !request.evidenceIds.includes(fact.id)) return false;
      if (edge.relation === "api-request") return source.sourceNodeIds[0] === sourceId;
      if (edge.relation !== "api-route" || endpoint?.kind !== "server" || endpoint.sourceNodeIds[0] !== relation.targetId) return false;
      return nodeFacts(endpoint).some(item => item.origin.kind === "entry-point" && item.origin.entryPoint.kind === "api"
        && item.origin.entryPoint.nodeId === relation.targetId && item.origin.entryPoint.method === relation.requestMethod);
    }
    return ["call", "reference", "component"].includes(edge.relation) && edge.relation === relation.relation
      && source.kind !== "api-request" && target.kind !== "api-request" && source.kind !== "event" && target.kind !== "event"
      && source.sourceNodeIds[0] === sourceId && target.sourceNodeIds[0] === relation.targetId
      && (target.id === flow.entryNodeId || !(analysis.entryPoints ?? []).some(entry => entry.nodeId === relation.targetId));
  }

  for (const edge of flow.edges) {
    references(edge.evidenceIds, edge.id);
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) { fail("dangling-edge", edge.id); continue; }
    const facts = edge.evidenceIds.flatMap(id => evidence.get(id) ?? []);
    if (edge.id !== behaviorId("edge", edge.source, edge.target, edge.relation) || edge.confidence !== "confirmed"
      || edge.semantics !== "static-relation" || edge.executionOrder !== "not-established" || !facts.length
      || !equalIds(edge.sourceEdgeIds, facts.flatMap(item => item.sourceEdgeIds))
      || facts.some(fact => !validatesEdgeFact(edge, fact, source, target))) fail("unverified-edge", edge.id);
    if (source.kind === "server" && source.id !== flow.entryNodeId) fail("api-boundary-expanded", edge.id);
  }
  for (const node of flow.nodes.filter(item => item.kind === "api-request")) {
    if (!flow.edges.some(edge => edge.target === node.id && edge.relation === "api-request")
      || !flow.edges.some(edge => edge.source === node.id && edge.relation === "api-route")) fail("incomplete-api-request", node.id);
  }
  for (const node of flow.nodes.filter(item => item.kind === "event")) {
    if (!flow.edges.some(edge => edge.target === node.id && edge.relation === "event-binding")
      || !flow.edges.some(edge => edge.source === node.id && edge.relation === "event-handler")) fail("incomplete-event", node.id);
  }
  for (const finding of flow.eventBindings ?? []) {
    references(finding.evidenceIds, finding.bindingId);
    const binding = mapper.eventBindings.get(finding.bindingId);
    const fact = mapper.eventBinding(finding.bindingId);
    if (!binding || binding.ownerNodeId !== finding.ownerNodeId || finding.confidence !== binding.confidence
      || !equalIds(finding.evidenceIds, fact ? [fact.id] : [])
      || !flow.nodes.some(node => node.kind !== "event" && node.sourceNodeIds[0] === finding.ownerNodeId)) fail("unverified-event-finding", finding.bindingId);
    if (finding.status === "projected" && (binding?.status !== "confirmed" || finding.reason
      || nodes.get(finding.eventNodeId ?? "")?.eventBindingId !== finding.bindingId)) fail("invalid-event-projection", finding.bindingId);
    if (finding.status !== "projected" && finding.eventNodeId) fail("non-projected-event-has-node", finding.bindingId);
  }
  for (const item of flow.unresolved) {
    references(item.evidenceIds, item.id);
    const fn = mapper.functions.get(item.sourceNodeId);
    if (!flow.nodes.some(node => node.sourceNodeIds.includes(item.sourceNodeId)) || !fn?.relations?.some(relation =>
      relation.relation === item.relation && relation.name === item.targetName && relation.confidence === item.confidence
      && (item.relation !== "api" || (item.request?.path === relation.requestPath && item.request?.method === relation.requestMethod)))
      || item.sourceEdgeIds.some(id => mapper.edges.get(id)?.source !== item.sourceNodeId)) fail("unverified-unresolved-relation", item.id);
  }

  const reachable = new Set(flow.entryNodeId ? [flow.entryNodeId] : []);
  const queue = [...reachable];
  const outgoing = new Map<string, string[]>();
  for (const edge of flow.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  for (let cursor = 0; cursor < queue.length; cursor++) for (const target of outgoing.get(queue[cursor]) ?? []) {
    if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
  }
  if (flow.nodes.some(node => !reachable.has(node.id))) fail("unreachable-node", flow.id);
  const details = index(flow.controlFlows ?? []);
  for (const detail of details.values()) if (!validateFunctionControlFlow(detail, analysis).valid) fail("invalid-control-flow-detail", detail.id);
  for (const node of flow.nodes) if (node.controlFlowId) {
    const detail = details.get(node.controlFlowId);
    if (!["screen", "server", "function"].includes(node.kind) || detail?.ownerFunctionId !== node.sourceNodeIds[0]) fail("control-flow-owner-mismatch", node.id);
  }
  for (const edge of flow.edges) if (edge.callContexts) {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    const detail = source?.controlFlowId ? details.get(source.controlFlowId) : undefined;
    if (edge.relation !== "call" || !detail || !target
      || canonical(edge.callContexts) !== canonical(contextsForCall(detail, edge.sourceEdgeIds, target.sourceNodeIds[0]))) fail("invalid-call-context", edge.id);
  }
  if (flow.httpRequests && canonical(flow.httpRequests) !== canonical(projectHttpRequests(flow, analysis))) fail("invalid-http-boundaries", flow.id);
  if (flow.databaseAccesses && canonical(flow.databaseAccesses) !== canonical(projectDatabaseAccesses(flow, analysis))) fail("invalid-database-accesses", flow.id);
  if (flow.serverResponses && canonical(flow.serverResponses) !== canonical(projectServerResponses(flow, analysis))) fail("invalid-server-responses", flow.id);
  return { valid: errors.length === 0, errors };
}
