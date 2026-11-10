import type { FunctionRelation, RepositoryAnalysis, RepositoryEntryPoint } from "@/types/analysis";
import type {
  BehaviorAnalysis, BehaviorBuildOptions, BehaviorEdge, BehaviorEventFinding, BehaviorEvidence, BehaviorFlow, BehaviorLimitation, BehaviorNode,
  BehaviorUnresolvedRelation,
} from "@/types/behavior";
import { behaviorId, canonical, createEvidenceMapper, edgeMatchesRelation, relationsOf, sameEntry } from "./evidenceMapper";
import { validateBehaviorFlow } from "./flowValidator";
import { attachControlFlowDetails } from "./controlFlowDetails";
import { projectHttpRequests } from "./httpDetails";
import { projectDatabaseAccesses } from "./databaseDetails";
import { projectServerResponses } from "./responseDetails";

export function behaviorLimitations(analysis: RepositoryAnalysis): BehaviorLimitation[] {
  return [
    { code: "execution-order-unavailable", message: "Static relationships do not establish execution order, invocation count, or reachability at runtime." },
    { code: "event-semantics-unavailable", message: "Explicit supported DOM bindings may be extracted, but event dispatch, component prop forwarding, and handler execution are not established." },
    { code: "conditions-unavailable", message: "The outer graph does not encode branch choices. Optional function-body CFG details are structural, not runtime traces." },
    { code: "data-access-unavailable", message: analysis.databaseAccess ? "Optional Prisma access metadata is source-backed; other clients, query results, schemas and transaction commits remain unverified. See databaseAccess.limitations." : "DB operations, schemas, and transactions are not semantically identified." },
    { code: "results-unavailable", message: analysis.serverResponses ? "Optional response creation/local-return references and limited const provenance are available; runtime delivery and inter-function return values remain unverified." : "Return values and response/data flow are not extracted." },
    ...(!analysis.collection?.commitSha ? [{ code: "unversioned-source" as const, message: "No commit SHA is available; locations refer only to this supplied analysis snapshot." }] : []),
    ...(analysis.collection?.partial ? [{ code: "partial-source" as const, message: "Source collection was partial; absent connections do not prove the absence of behavior." }] : []),
  ];
}

function budget(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

/** Pure projection of existing AST facts. Does not call discovery, DFS, UI, DB, or AI. */
export function buildBehaviorFlow(analysis: RepositoryAnalysis, entryPoint: RepositoryEntryPoint, options: BehaviorBuildOptions = {}): BehaviorFlow {
  const mapper = createEvidenceMapper(analysis);
  const maxDepth = budget(options.maxDepth, 12, 0, 50);
  const maxNodes = budget(options.maxNodes, 200, 1, 1000);
  const maxEdges = budget(options.maxEdges, 400, 0, 2000);
  const includeEvents = options.includeEvents !== false;
  const flow: BehaviorFlow = {
    schemaVersion: 1, id: behaviorId("flow", analysis.repository, entryPoint), repository: analysis.repository,
    commitSha: analysis.collection?.commitSha, entryPoint: { ...entryPoint }, status: "partial",
    semantics: "static-code-relations", executionOrder: "not-established",
    nodes: [], edges: [], evidence: [], unresolved: [], limitations: behaviorLimitations(analysis),
  };
  const nodes = new Map<string, BehaviorNode>();
  const edges = new Map<string, BehaviorEdge>();
  const evidence = new Map<string, BehaviorEvidence>();
  const unresolved = new Map<string, BehaviorUnresolvedRelation>();
  const limitations = new Map<string, BehaviorLimitation>();
  const symbolId = (codeId: string) => behaviorId("node", flow.id, codeId);
  const registered = analysis.entryPoints ?? [];
  const entryIds = new Set(registered.map(item => item.nodeId));
  const outgoing = new Map<string, typeof analysis.edges>();
  for (const edge of mapper.edges.values()) {
    const group = outgoing.get(edge.source) ?? [];
    group.push(edge);
    outgoing.set(edge.source, group);
  }

  function addEvidence(item: BehaviorEvidence): string {
    const previous = evidence.get(item.id);
    evidence.set(item.id, { ...item, sourceEdgeIds: [...new Set([...(previous?.sourceEdgeIds ?? []), ...item.sourceEdgeIds])].sort() });
    return item.id;
  }
  function note(item: BehaviorLimitation) { limitations.set(canonical(item), item); }
  function missing(sourceId: string, item: FunctionRelation, reason: BehaviorUnresolvedRelation["reason"], edgeIds: string[] = []) {
    const mapped = mapper.relation(sourceId, item, edgeIds);
    const id = behaviorId("unresolved", sourceId, item, reason);
    unresolved.set(id, {
      id, sourceNodeId: sourceId, relation: item.relation, targetName: item.name,
      confidence: item.confidence, reason,
      request: item.relation === "api" ? { path: item.requestPath, method: item.requestMethod } : undefined,
      evidenceIds: mapped ? [addEvidence(mapped)] : [], sourceEdgeIds: [...edgeIds].sort(),
    });
  }
  function symbol(codeId: string, entry?: RepositoryEntryPoint): BehaviorNode | undefined {
    const declaration = mapper.declaration(codeId), original = mapper.nodes.get(codeId);
    if (!declaration || !original) return undefined;
    const route = entry && mapper.entryPoint(entry);
    if (entry && !route) return undefined;
    return {
      id: symbolId(codeId), kind: entry?.kind === "page" ? "screen" : entry?.kind === "api" ? "server" : "function",
      label: original.name,
      confidence: "confirmed", sourceNodeIds: [codeId], sourceEdgeIds: [],
      evidenceIds: [addEvidence(declaration), ...(route ? [addEvidence(route)] : [])],
    };
  }
  function makeEdge(source: string, target: string, relation: BehaviorEdge["relation"], item: BehaviorEvidence): BehaviorEdge {
    return {
      id: behaviorId("edge", source, target, relation), source, target, relation, confidence: "confirmed",
      semantics: "static-relation", executionOrder: "not-established", sourceEdgeIds: [...item.sourceEdgeIds], evidenceIds: [item.id],
    };
  }
  function addEdge(edge: BehaviorEdge) {
    const previous = edges.get(edge.id);
    edges.set(edge.id, { ...edge,
      evidenceIds: [...new Set([...(previous?.evidenceIds ?? []), ...edge.evidenceIds])].sort(),
      sourceEdgeIds: [...new Set([...(previous?.sourceEdgeIds ?? []), ...edge.sourceEdgeIds])].sort(),
    });
  }

  const initial = registered.some(item => sameEntry(item, entryPoint)) && symbol(entryPoint.nodeId, entryPoint);
  if (!initial) {
    flow.status = "unavailable";
    flow.limitations.push({ code: "entry-point-unavailable", message: "No registered entry point with mappable declaration/export-file evidence is available." });
    return flow;
  }
  nodes.set(initial.id, initial);
  flow.entryNodeId = initial.id;
  const queue = [{ id: entryPoint.nodeId, depth: 0 }];
  const queued = new Set([entryPoint.nodeId]);
  const replacedReferences = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const fn = mapper.functions.get(current.id);
    if (!fn) continue;
    if (includeEvents) for (const binding of [...mapper.eventBindings.values()].filter(item => item.ownerNodeId === current.id).sort((a, b) => a.startOffset - b.startOffset)) {
      const mapped = mapper.eventBinding(binding.id);
      const finding: BehaviorEventFinding = {
        bindingId: binding.id, ownerNodeId: current.id, confidence: binding.confidence,
        status: "unresolved", reason: binding.reason,
        evidenceIds: mapped ? [addEvidence(mapped)] : [],
      };
      (flow.eventBindings ??= []).push(finding);
      if (!mapped) { finding.reason = "evidence-unavailable"; continue; }
      if (binding.status !== "confirmed" || !binding.targetNodeId) continue;
      if (binding.targetNodeId !== entryPoint.nodeId && entryIds.has(binding.targetNodeId)) {
        finding.status = "excluded"; finding.reason = "entry-boundary"; continue;
      }
      const target = symbol(binding.targetNodeId);
      if (!target) { finding.reason = "evidence-unavailable"; continue; }
      const event: BehaviorNode = {
        id: behaviorId("event", flow.id, binding.id), kind: "event", label: `<${binding.element.name}> ${binding.eventName} 바인딩`,
        confidence: "confirmed", sourceNodeIds: [current.id], sourceEdgeIds: [], evidenceIds: [mapped.id], eventBindingId: binding.id,
      };
      const projected = [makeEdge(symbolId(current.id), event.id, "event-binding", mapped), makeEdge(event.id, target.id, "event-handler", mapped)];
      const addedNodes = [target, event].filter(node => !nodes.has(node.id));
      if (current.depth >= maxDepth || nodes.size + addedNodes.length > maxNodes
        || edges.size + projected.filter(edge => !edges.has(edge.id)).length > maxEdges) {
        finding.status = "excluded"; finding.reason = "traversal-limit";
        note({ code: "traversal-limit", message: "The configured budget excludes an event binding and its handler projection." });
        continue;
      }
      for (const node of addedNodes) nodes.set(node.id, node);
      for (const edge of projected) addEdge(edge);
      finding.status = "projected"; finding.reason = undefined; finding.eventNodeId = event.id;
      if (!queued.has(binding.targetNodeId)) { queued.add(binding.targetNodeId); queue.push({ id: binding.targetNodeId, depth: current.depth + 1 }); }
    }
    if (includeEvents) for (const relation of relationsOf(fn).filter(item => item.relation === "reference")) {
      const sites = [...mapper.eventBindings.values()].filter(binding => binding.ownerNodeId === current.id && binding.targetNodeId === relation.targetId
        && relation.line === binding.line && relation.evidence === binding.sourceCode.replace(/\s+/g, " ").slice(0, 240));
      // Same-line DOM and custom props can share the old merged reference. Keep it
      // unless EVERY matching site was projected, so unresolved props do not disappear.
      if (sites.length && sites.every(binding => flow.eventBindings?.some(finding => finding.bindingId === binding.id && finding.status === "projected"))) {
        replacedReferences.add(canonical([current.id, relation]));
      }
    }
    for (const item of relationsOf(fn).sort((a, b) => canonical(a).localeCompare(canonical(b)))) {
      if (replacedReferences.has(canonical([current.id, item]))) continue;
      const candidateEdges = (outgoing.get(current.id) ?? []).filter(edge => edgeMatchesRelation(edge, current.id, item));
      const confirmed = candidateEdges.filter(edge => edge.confidence === "confirmed");
      const edgeIds = confirmed.map(edge => edge.id).sort();
      if (item.confidence !== "confirmed") { missing(current.id, item, "inferred-relation"); continue; }
      if (!item.targetId || !mapper.nodes.has(item.targetId)) { missing(current.id, item, "unresolved-target"); continue; }
      const mapped = edgeIds.length ? mapper.relation(current.id, item, edgeIds) : undefined;
      if (!mapped || !mapper.declaration(item.targetId)) {
        missing(current.id, item, "evidence-unavailable");
        note({ code: "evidence-unavailable", message: "A relationship without consistent source/graph/declaration evidence was excluded.", sourceNodeIds: [current.id], sourceEdgeIds: candidateEdges.map(edge => edge.id).sort() });
        continue;
      }
      const boundary = item.targetId !== entryPoint.nodeId && entryIds.has(item.targetId);
      const targetEntry = item.relation === "api" ? registered.find(entry => entry.nodeId === item.targetId && entry.kind === "api" && entry.method === item.requestMethod) : undefined;
      if ((boundary && item.relation !== "api") || (item.relation === "api" && (!targetEntry || !item.requestPath?.startsWith("/") || item.requestPath.startsWith("//")))) {
        missing(current.id, item, "entry-boundary", edgeIds);
        note({ code: "entry-boundary", message: "Other page/API entry implementations are not merged into this flow.", sourceNodeIds: [item.targetId] });
        continue;
      }
      if (current.depth >= maxDepth) {
        missing(current.id, item, "traversal-limit", edgeIds);
        note({ code: "traversal-limit", message: "The configured depth limit excludes additional static relationships." });
        continue;
      }
      const target = symbol(item.targetId, targetEntry);
      if (!target) { missing(current.id, item, "evidence-unavailable"); continue; }
      const request: BehaviorNode | undefined = item.relation === "api" ? {
        id: behaviorId("request", flow.id, mapped.id), kind: "api-request", label: `${item.requestMethod} ${item.requestPath}`,
        confidence: "confirmed", sourceNodeIds: [current.id], sourceEdgeIds: edgeIds, evidenceIds: [mapped.id],
        request: { path: item.requestPath!, method: item.requestMethod! },
      } : undefined;
      const projected = request ? [
        makeEdge(symbolId(current.id), request.id, "api-request", mapped), makeEdge(request.id, target.id, "api-route", mapped),
      ] : [makeEdge(symbolId(current.id), target.id, item.relation === "api" ? "api-request" : item.relation, mapped)];
      const addedNodes = [target, ...(request ? [request] : [])].filter(node => !nodes.has(node.id));
      const addedEdges = projected.filter(edge => !edges.has(edge.id));
      if (nodes.size + addedNodes.length > maxNodes || edges.size + addedEdges.length > maxEdges) {
        missing(current.id, item, "traversal-limit", edgeIds);
        note({ code: "traversal-limit", message: "The node/edge budget excludes additional static relationships." });
        continue;
      }
      addEvidence(mapped);
      for (const node of addedNodes) nodes.set(node.id, node);
      const existingTarget = nodes.get(target.id)!;
      existingTarget.evidenceIds = [...new Set([...existingTarget.evidenceIds, ...target.evidenceIds])].sort();
      for (const edge of projected) addEdge(edge);
      if (boundary) {
        note({ code: "entry-boundary", message: "The API endpoint is shown as a boundary; its implementation has its own flow.", sourceNodeIds: [item.targetId] });
      } else if (!queued.has(item.targetId)) {
        queued.add(item.targetId);
        queue.push({ id: item.targetId, depth: current.depth + 1 });
      }
    }
  }
  flow.nodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  flow.edges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  flow.unresolved = [...unresolved.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Discard evidence speculatively collected for a node excluded by a budget.
  const usedEvidence = new Set([...flow.nodes, ...flow.edges, ...flow.unresolved, ...(flow.eventBindings ?? [])].flatMap(item => item.evidenceIds));
  flow.evidence = [...evidence.values()].filter(item => usedEvidence.has(item.id)).sort((a, b) => a.id.localeCompare(b.id));
  flow.limitations.push(...limitations.values());
  attachControlFlowDetails(flow, analysis, options);
  if (analysis.httpRequests) flow.httpRequests = projectHttpRequests(flow, analysis);
  if (analysis.databaseAccess) flow.databaseAccesses = projectDatabaseAccesses(flow, analysis);
  if (analysis.serverResponses) flow.serverResponses = projectServerResponses(flow, analysis);
  const validation = validateBehaviorFlow(flow, analysis);
  if (!validation.valid) {
    return { ...flow, status: "unavailable", entryNodeId: undefined, nodes: [], edges: [], evidence: [], unresolved: [], eventBindings: undefined, controlFlows: undefined, httpRequests: undefined, databaseAccesses: undefined, serverResponses: undefined,
      limitations: [...flow.limitations, { code: "invalid-analysis", message: `Projection rejected by provenance validation (${validation.errors.map(item => item.code).join(", ")}).` }],
    };
  }
  return flow;
}

export function buildBehaviorFlows(analysis: RepositoryAnalysis, options: BehaviorBuildOptions = {}): BehaviorAnalysis {
  const entries = [...new Map((analysis.entryPoints ?? []).map(entry => [canonical(entry), entry])).values()]
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return {
    schemaVersion: 1, repository: analysis.repository,
    flows: entries.map(entry => buildBehaviorFlow(analysis, entry, options)),
    limitations: [...behaviorLimitations(analysis), ...(!entries.length ? [{ code: "entry-point-unavailable" as const, message: "No supported page/API entry metadata was extracted; function names are not used as fallback entries." }] : [])],
  };
}
