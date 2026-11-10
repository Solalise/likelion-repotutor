import type {
  ControlFlowCompletion, ControlFlowContext, ControlFlowEdge, ControlFlowNode, FunctionControlFlow,
} from "@/types/controlFlow";

export const controlId = (kind: string, ...parts: unknown[]) => `control:${kind}:${JSON.stringify(parts)}`;
export const CONTROL_GRAPH_LIMITS = { nodes: 2000, edges: 4000 } as const;
type Port = { nodeId: string; kind: ControlFlowEdge["kind"]; completion: ControlFlowCompletion; certainty: ControlFlowEdge["certainty"]; reason?: ControlFlowEdge["reason"] };
type CompletionPorts = Record<ControlFlowCompletion, Port[]>;
const empty = (): CompletionPorts => ({ normal: [], return: [], throw: [], unknown: [] });
const port = (nodeId: string, kind: Port["kind"] = "next", completion: ControlFlowCompletion = "normal", certainty: Port["certainty"] = "structural"): Port => ({ nodeId, kind, completion, certainty });

/** Structured completion propagation; finally is cloned per pending completion. */
export function buildControlGraph(flow: FunctionControlFlow, limits: { nodes?: number; edges?: number } = {}): void {
  const bound = (value: number | undefined, maximum: number, minimum: number) => value !== undefined && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : maximum;
  const maxNodes = bound(limits.nodes, CONTROL_GRAPH_LIMITS.nodes, 6);
  const maxEdges = bound(limits.edges, CONTROL_GRAPH_LIMITS.edges, 1);
  const statements = new Map(flow.statements.map(statement => [statement.id, statement]));
  const nodes = new Map<string, ControlFlowNode>();
  const edges = new Map<string, ControlFlowEdge>();
  let truncated = false;
  const synthetic = (kind: Exclude<ControlFlowNode["kind"], "statement">) => {
    const id = controlId("node", flow.ownerFunctionId, kind);
    nodes.set(id, { id, ownerFunctionId: flow.ownerFunctionId, kind, context: [], reachability: "unreachable-in-model" });
    return id;
  };
  flow.entryNodeId = synthetic("entry");
  flow.exits = { normal: synthetic("normal-exit"), return: synthetic("return-exit"), throw: synthetic("throw-exit"), unknown: synthetic("analysis-boundary") };

  function connect(incoming: Port[], target: string) {
    for (const item of incoming) {
      const edge: ControlFlowEdge = { id: controlId("edge", item.nodeId, target, item.kind, item.completion, item.certainty, item.reason),
        source: item.nodeId, target, kind: item.kind, completion: item.completion, certainty: item.certainty,
        semantics: "static-control-flow", ...(item.reason ? { reason: item.reason } : {}) };
      if (!edges.has(edge.id) && edges.size >= maxEdges) { truncated = true; continue; }
      edges.set(edge.id, edge);
    }
  }
  function sequence(ids: string[], incoming: Port[], context: ControlFlowContext[]): CompletionPorts {
    const result = empty();
    let normal = incoming;
    for (const id of ids) {
      const next = statement(id, normal, context);
      normal = next.normal;
      result.return.push(...next.return); result.throw.push(...next.throw); result.unknown.push(...next.unknown);
    }
    result.normal = normal;
    return result;
  }
  function statement(id: string, incoming: Port[], context: ControlFlowContext[]): CompletionPorts {
    const item = statements.get(id);
    if (!item) { truncated = true; connect(incoming.map(p => ({ ...p, kind: "unknown", completion: "unknown", reason: "unsupported-region" })), flow.exits.unknown); return empty(); }
    const nodeId = controlId("statement-node", flow.ownerFunctionId, item.id, context);
    if (!nodes.has(nodeId) && nodes.size >= maxNodes) {
      truncated = true;
      connect(incoming.map(p => ({ ...p, kind: "unknown", completion: "unknown", reason: "unsupported-region" })), flow.exits.unknown);
      return empty();
    }
    nodes.set(nodeId, { id: nodeId, ownerFunctionId: flow.ownerFunctionId, kind: "statement", statementId: item.id,
      context: context.map(value => ({ ...value })), reachability: "unreachable-in-model" });
    connect(incoming, nodeId);
    const active = incoming.length > 0;
    const start = active ? [port(nodeId)] : [];
    const result = empty();
    if (item.kind === "unsupported") {
      if (active) result.unknown = [{ ...port(nodeId, "unknown", "unknown"), reason: "unsupported-region" }];
      return result;
    }
    if (item.kind === "if") {
      const yes = sequence(item.thenBranch ?? [], active ? [port(nodeId, "true")] : [], context);
      const no = sequence(item.elseBranch ?? [], active ? [port(nodeId, "false")] : [], context);
      for (const completion of ["normal", "return", "throw", "unknown"] as const) result[completion].push(...yes[completion], ...no[completion]);
    } else if (item.kind === "try") {
      const body = sequence(item.tryBlockId ? [item.tryBlockId] : [], start, context);
      if (item.catchClauseId) {
        const caught = sequence([item.catchClauseId], body.throw, context);
        result.normal.push(...body.normal, ...caught.normal);
        result.return.push(...body.return, ...caught.return);
        result.throw.push(...caught.throw);
        result.unknown.push(...body.unknown, ...caught.unknown);
      } else for (const completion of ["normal", "return", "throw", "unknown"] as const) result[completion].push(...body[completion]);
      if (item.finallyClauseId) {
        const finished = empty();
        // Unknown syntax may never complete; do not invent a path through finally.
        finished.unknown.push(...result.unknown);
        let built = false;
        for (const completion of ["normal", "return", "throw"] as const) {
          if (!result[completion].length) continue;
          built = true;
          const finalContext = [...context, { tryStatementId: item.id, pendingCompletion: completion }];
          const final = sequence([item.finallyClauseId], result[completion].map(p => ({ ...p, kind: "finally", completion })), finalContext);
          finished[completion].push(...final.normal.map(p => ({ ...p, kind: "resume" as const, completion })));
          // Abrupt completion of finally overrides the pending completion.
          finished.return.push(...final.return); finished.throw.push(...final.throw); finished.unknown.push(...final.unknown);
        }
        if (!built) sequence([item.finallyClauseId], [], context);
        return finished;
      }
    } else if (["block", "catch", "finally"].includes(item.kind)) {
      const nested = sequence(item.children ?? [], start, context);
      for (const completion of ["normal", "return", "throw", "unknown"] as const) result[completion].push(...nested[completion]);
    } else if (item.kind === "return") {
      if (active) result.return.push(port(nodeId, "return", "return"));
    } else if (item.kind === "throw") {
      if (active) result.throw.push(port(nodeId, "throw", "throw"));
    } else result.normal = start;
    if (active && item.mayThrow && item.kind !== "throw") result.throw.push({ ...port(nodeId, "exception", "throw", "possible"), reason: "expression-may-throw" });
    return result;
  }

  const body = sequence(flow.bodyStatementIds, [port(flow.entryNodeId)], []);
  connect(body.normal, flow.exits.normal); connect(body.return, flow.exits.return); connect(body.throw, flow.exits.throw); connect(body.unknown, flow.exits.unknown);
  const reachable = new Set([flow.entryNodeId]);
  const queue = [...reachable];
  const outgoing = new Map<string, string[]>();
  for (const edge of edges.values()) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  for (let cursor = 0; cursor < queue.length; cursor++) for (const target of outgoing.get(queue[cursor]) ?? []) if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
  const uncertain = truncated || [...nodes.values()].some(node => reachable.has(node.id) && node.statementId && statements.get(node.statementId)?.kind === "unsupported");
  for (const node of nodes.values()) node.reachability = reachable.has(node.id) ? "reachable-in-model" : uncertain ? "unknown" : "unreachable-in-model";
  for (const item of flow.statements) {
    const instances = [...nodes.values()].filter(node => node.statementId === item.id);
    item.reachability = instances.some(node => node.reachability === "reachable-in-model") ? "reachable-in-model"
      : uncertain || !instances.length ? "unknown" : "unreachable-in-model";
  }
  if (truncated) { flow.status = "partial"; flow.limitations.push({ code: "graph-budget", message: "CFG node/edge budget exceeded; missing continuations are unknown, not normal execution paths." }); }
  flow.nodes = [...nodes.values()]; flow.edges = [...edges.values()];
}
