import type { CodeEdge, CodeEdgeOccurrence, CodeNode, RelationConfidence, TraversalResult } from "@/types/analysis";

interface GraphEdge { id: string; source: string; target: string; relation?: string; confidence?: RelationConfidence }
interface OccurrenceEdge extends GraphEdge { occurrences?: CodeEdgeOccurrence[]; line?: number; evidence?: string }
const DISPLAY_RELATION_PRIORITY: Record<CodeEdge["relation"], number> = { api: 0, call: 1, reference: 2, component: 3, import: 4 };
const edgeKey = (edge: GraphEdge) => JSON.stringify([edge.relation, edge.source, edge.target]);
const weakestConfidence = (values: Array<RelationConfidence | undefined>): RelationConfidence | undefined =>
  values.includes("inferred") ? "inferred" : values.every((value) => value === "confirmed") ? "confirmed" : undefined;

export function uniqueGraphNodes<T extends { id: string }>(nodes: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const node of nodes) if (!result.has(node.id)) result.set(node.id, node);
  return [...result.values()];
}

function uniqueEdges<E extends GraphEdge>(edges: readonly E[]): E[] {
  const result = new Map<string, E>();
  for (const edge of edges) {
    const previous = result.get(edge.id);
    result.set(edge.id, previous ? { ...previous, confidence: weakestConfidence([previous.confidence, edge.confidence]) } : edge);
  }
  return [...result.values()];
}

/** Group display duplicates without losing occurrence evidence or promoting confidence. */
export function aggregateRelationEdges<E extends OccurrenceEdge>(edges: readonly E[]): E[] {
  const result = new Map<string, E>();
  for (const edge of edges) {
    const key = edgeKey(edge);
    const previous = result.get(key);
    const occurrences = new Map<string, CodeEdgeOccurrence>();
    for (const item of [...(previous?.occurrences ?? []), ...(edge.occurrences ?? [{ edgeId: edge.id, line: edge.line, evidence: edge.evidence, confidence: edge.confidence }])]) {
      const identity = JSON.stringify([item.edgeId, item.line, item.evidence]);
      const existing = occurrences.get(identity);
      occurrences.set(identity, existing ? { ...existing, confidence: weakestConfidence([existing.confidence, item.confidence]) } : { ...item });
    }
    const representative = previous && previous.id.localeCompare(edge.id) <= 0 ? previous : edge;
    const items = [...occurrences.values()].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.edgeId.localeCompare(b.edgeId));
    result.set(key, { ...representative, occurrences: items,
      confidence: weakestConfidence([...(previous ? [previous.confidence] : []), edge.confidence, ...items.map((item) => item.confidence)]) });
  }
  return [...result.values()];
}

export function aggregateDisplayEdges(edges: CodeEdge[]): CodeEdge[] {
  return aggregateRelationEdges(edges).map((edge) => ({ ...edge, id: `display:${edgeKey(edge)}` }));
}

function depthLimit(value: number): number {
  return Number.isNaN(value) ? -1 : Math.floor(value);
}
function limit(value: number, maximum = Number.POSITIVE_INFINITY): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(maximum, Math.floor(value)));
}

export interface DepthFirstReachability<E extends GraphEdge> {
  depths: Map<string, number>;
  parents: Map<string, E>;
  edges: E[];
}

/** Iterative DFS with distance relaxation. A shorter arrival reopens a node's depth budget. */
export function depthFirstReachability<E extends GraphEdge>(
  start: string, nodeIds: Iterable<string>, inputEdges: readonly E[], maxDepth = Number.POSITIVE_INFINITY,
  around = false, compare?: (a: E, b: E, from: string) => number,
): DepthFirstReachability<E> {
  const ids = new Set(nodeIds);
  const depth = depthLimit(maxDepth);
  const edges = uniqueEdges(inputEdges).filter((edge) => edge.relation !== "import" && ids.has(edge.source) && ids.has(edge.target));
  const depths = new Map<string, number>();
  const parents = new Map<string, E>();
  if (!ids.has(start) || depth < 0) return { depths, parents, edges: [] };
  const adjacency = new Map<string, Array<{ edge: E; next: string }>>();
  const append = (from: string, item: { edge: E; next: string }) => {
    const items = adjacency.get(from);
    if (items) items.push(item); else adjacency.set(from, [item]);
  };
  for (const edge of edges) {
    append(edge.source, { edge, next: edge.target });
    if (around && edge.source !== edge.target) append(edge.target, { edge, next: edge.source });
  }
  for (const [from, items] of adjacency) items.sort((a, b) => (compare?.(a.edge, b.edge, from) ?? 0)
    || a.next.localeCompare(b.next) || a.edge.id.localeCompare(b.edge.id));
  const stack: Array<{ id: string; depth: number; parent?: E }> = [{ id: start, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > depth || (depths.get(current.id) ?? Infinity) <= current.depth) continue;
    depths.set(current.id, current.depth);
    if (current.parent) parents.set(current.id, current.parent);
    if (current.depth === depth) continue;
    for (const item of [...(adjacency.get(current.id) ?? [])].reverse()) {
      if ((depths.get(item.next) ?? Infinity) > current.depth + 1) stack.push({ id: item.next, depth: current.depth + 1, parent: item.edge });
    }
  }
  return { depths, parents, edges: edges.filter((edge) => depths.has(edge.source) && depths.has(edge.target)
    && (around ? Math.min(depths.get(edge.source)!, depths.get(edge.target)!) : depths.get(edge.source)!) < depth) };
}

/** Add whole minimum-depth paths so a display limit never leaves detached descendants. */
export function selectConnectedNodeIds<E extends GraphEdge>(start: string, reachable: DepthFirstReachability<E>, maxNodes: number, pinned: string[] = []): Set<string> {
  const selected = new Set<string>();
  const capacity = limit(maxNodes);
  if (!reachable.depths.has(start) || capacity < 1) return selected;
  selected.add(start);
  for (const id of [...pinned, ...reachable.depths.keys()]) {
    const path: string[] = [];
    let current = id;
    while (!selected.has(current) && reachable.depths.has(current)) {
      path.push(current);
      const edge = reachable.parents.get(current);
      if (!edge) break;
      current = edge.source === current ? edge.target : edge.source;
    }
    if (selected.size + path.length <= capacity) for (const item of path.reverse()) selected.add(item);
  }
  return selected;
}

interface DisplayGraphOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
  expandedNodeIds?: Iterable<string>;
  selectedNodeId?: string;
}
interface State { id: string; component: boolean; depth: number; parent?: { key: string; edge: CodeEdge } }
const stateKey = (id: string, component: boolean) => JSON.stringify([id, component]);
const compareEdges = (a: CodeEdge, b: CodeEdge) => DISPLAY_RELATION_PRIORITY[a.relation] - DISPLAY_RELATION_PRIORITY[b.relation]
  || a.target.localeCompare(b.target) || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id);

/** Counting beyond Depth needs reachability only, not unbounded shortest-path relaxation. */
function allReachable(start: string, ids: Set<string>, edges: CodeEdge[]): Set<string> {
  const visited = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source);
    if (targets) targets.push(edge.target); else adjacency.set(edge.source, [edge.target]);
  }
  const stack = ids.has(start) ? [start] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const target of adjacency.get(id) ?? []) if (!visited.has(target)) stack.push(target);
  }
  return visited;
}

/** Reachability and component folding are independent from node/edge display limits. */
export function traceDisplayGraph(start: string, inputNodes: CodeNode[], inputEdges: CodeEdge[], options: DisplayGraphOptions = {}): TraversalResult {
  const nodes = uniqueGraphNodes(inputNodes.filter((node) => node.type !== "file"));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const maxDepth = depthLimit(options.maxDepth ?? 5);
  const traversable = uniqueEdges(inputEdges).filter((edge) => edge.relation !== "import" && nodeMap.has(edge.source) && nodeMap.has(edge.target));
  const allIds = allReachable(start, new Set(nodeMap.keys()), traversable);
  const allEdges = traversable.filter((edge) => allIds.has(edge.source) && allIds.has(edge.target));
  const bounded = depthFirstReachability(start, nodeMap.keys(), traversable, maxDepth, false, compareEdges);
  const inDepth = new Set(bounded.depths.keys());
  const depthEdges = bounded.edges;
  const expanded = new Set([...(options.expandedNodeIds ?? [])].filter((id) => inDepth.has(id)));
  const maxNodes = limit(limit(options.maxNodes ?? 18, 80) + expanded.size * 10, 80);
  const maxEdges = limit(limit(options.maxEdges ?? 32, 140) + expanded.size * 12, 140);
  const outgoing = new Map<string, CodeEdge[]>();
  for (const edge of depthEdges) {
    const items = outgoing.get(edge.source);
    if (items) items.push(edge); else outgoing.set(edge.source, [edge]);
  }
  for (const items of outgoing.values()) items.sort(compareEdges);

  const states = new Map<string, State>();
  const bestState = new Map<string, string>();
  const allowed = new Map<string, CodeEdge>();
  const stack: State[] = inDepth.has(start) ? [{ id: start, component: false, depth: 0 }] : [];
  while (stack.length) {
    const current = stack.pop()!;
    const key = stateKey(current.id, current.component);
    if (current.depth > maxDepth || (states.get(key)?.depth ?? Infinity) <= current.depth) continue;
    states.set(key, current);
    const previous = bestState.get(current.id);
    if (!previous || states.get(previous)!.depth > current.depth) bestState.set(current.id, key);
    if (current.depth === maxDepth) continue;
    for (const edge of [...(outgoing.get(current.id) ?? [])].reverse()) {
      if (edge.relation === "component" && current.component && !expanded.has(current.id)) continue;
      allowed.set(edge.id, edge);
      const component = edge.relation === "component";
      if ((states.get(stateKey(edge.target, component))?.depth ?? Infinity) > current.depth + 1) {
        stack.push({ id: edge.target, component, depth: current.depth + 1, parent: { key, edge } });
      }
    }
  }

  const pin = options.selectedNodeId && bestState.has(options.selectedNodeId) ? [options.selectedNodeId] : [];
  const order = [...pin, ...[...expanded].sort(), ...bestState.keys()];
  const project = (edgeCapacity: number) => {
    const selected = new Set<string>();
    const connectors = new Set<string>();
    if (!bestState.has(start) || maxNodes === 0) return { selected, connectors };
    selected.add(start);
    for (const id of order) {
      let key = bestState.get(id);
      const pathNodes = new Set<string>();
      const pathEdges = new Set<string>();
      while (key) {
        const item = states.get(key)!;
        if (!selected.has(item.id)) pathNodes.add(item.id);
        if (item.parent) pathEdges.add(edgeKey(item.parent.edge));
        key = item.parent?.key;
      }
      const addedEdges = [...pathEdges].filter((item) => !connectors.has(item));
      if (selected.size + pathNodes.size > maxNodes || connectors.size + addedEdges.length > edgeCapacity) continue;
      for (const item of pathNodes) selected.add(item);
      for (const item of addedEdges) connectors.add(item);
    }
    return { selected, connectors };
  };
  const nodeBounded = project(Infinity);
  const visible = project(maxEdges);
  const candidates = aggregateDisplayEdges([...allowed.values()].filter((edge) => visible.selected.has(edge.source) && visible.selected.has(edge.target)))
    .sort((a, b) => Number(visible.connectors.has(edgeKey(b))) - Number(visible.connectors.has(edgeKey(a))) || compareEdges(a, b));
  const displayed = candidates.slice(0, maxEdges);
  const fullGroups = aggregateDisplayEdges(depthEdges);
  const hiddenIds = [...inDepth].filter((id) => !visible.selected.has(id));
  return {
    nodes: nodes.filter((node) => visible.selected.has(node.id)), edges: displayed,
    deferredNodeIds: hiddenIds, hiddenNodeCount: hiddenIds.length, hiddenEdgeCount: fullGroups.length - displayed.length,
    reachableNodeCount: inDepth.size, reachableEdgeCount: fullGroups.length,
    depthLimitedNodeCount: allIds.size - inDepth.size,
    depthLimitedEdgeCount: aggregateDisplayEdges(allEdges).length - fullGroups.length,
    collapsedNodeCount: inDepth.size - bestState.size,
    nodeLimitHiddenNodeCount: bestState.size - nodeBounded.selected.size,
    edgeLimitHiddenNodeCount: nodeBounded.selected.size - visible.selected.size,
  };
}

export function traverseGraph(start: string, nodes: CodeNode[], edges: CodeEdge[], maxDepth = 5): TraversalResult {
  const map = new Map(uniqueGraphNodes(nodes).map((node) => [node.id, node]));
  const result = depthFirstReachability(start, map.keys(), edges, maxDepth);
  return { nodes: [...result.depths.keys()].map((id) => map.get(id)!), edges: result.edges };
}

/** Explicit incoming/outgoing neighbourhood inspection, not an execution trace. */
export function traverseGraphAround(start: string, inputNodes: CodeNode[], edges: CodeEdge[], maxDepth = 5): TraversalResult {
  const nodes = uniqueGraphNodes(inputNodes);
  const result = depthFirstReachability(start, nodes.map((node) => node.id), edges, maxDepth, true);
  return { nodes: nodes.filter((node) => result.depths.has(node.id)), edges: result.edges };
}

/** Priority-guided neighbourhood DFS with a separate connected display budget. */
export function traceRelevantGraph(start: string, inputNodes: CodeNode[], edges: CodeEdge[], maxDepth = 5, maxNodes = 40): TraversalResult {
  const nodes = uniqueGraphNodes(inputNodes);
  const priority: Record<CodeEdge["relation"], number> = { api: 0, call: 1, component: 2, reference: 3, import: 4 };
  const reachable = depthFirstReachability(start, nodes.map((node) => node.id), edges, maxDepth, true,
    (a, b, from) => priority[a.relation] - priority[b.relation] || Number(b.source === from) - Number(a.source === from));
  const selected = selectConnectedNodeIds(start, reachable, maxNodes);
  return {
    nodes: nodes.filter((node) => selected.has(node.id)), edges: reachable.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
    deferredNodeIds: [...reachable.depths.keys()].filter((id) => !selected.has(id)),
    traversalStates: Object.fromEntries([...selected].map((id) => [id, "Used" as const])),
  };
}
