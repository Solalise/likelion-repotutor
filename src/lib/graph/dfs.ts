import type { CodeEdge, CodeNode, TraversalResult } from "@/types/analysis";

const DISPLAY_RELATION_PRIORITY: Record<CodeEdge["relation"], number> = {
  api: 0, call: 1, reference: 2, component: 3, import: 4,
};

function displayEdgeKey(edge: CodeEdge): string {
  return `${edge.relation}:${edge.source}->${edge.target}`;
}

export function aggregateDisplayEdges(edges: CodeEdge[]): CodeEdge[] {
  const grouped = new Map<string, CodeEdge>();
  for (const edge of edges) {
    const key = displayEdgeKey(edge);
    const occurrences = edge.occurrences ?? [{ edgeId: edge.id, line: edge.line, evidence: edge.evidence, confidence: edge.confidence }];
    const current = grouped.get(key);
    if (current) current.occurrences = [...(current.occurrences ?? []), ...occurrences];
    else grouped.set(key, { ...edge, id: `display:${key}`, occurrences: [...occurrences] });
  }
  return [...grouped.values()];
}

interface DisplayGraphOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
  expandedNodeIds?: Iterable<string>;
}

/** Builds a bounded screen projection without changing the original AST graph. */
export function traceDisplayGraph(
  startNodeId: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
  options: DisplayGraphOptions = {},
): TraversalResult {
  const maxDepth = options.maxDepth ?? 5;
  const expanded = new Set(options.expandedNodeIds ?? []);
  const maxNodes = Math.min(80, (options.maxNodes ?? 18) + expanded.size * 10);
  const maxEdges = Math.min(140, (options.maxEdges ?? 32) + expanded.size * 12);
  const nodeMap = new Map(nodes.filter((node) => node.type !== "file").map((node) => [node.id, node]));
  if (!nodeMap.has(startNodeId) || maxDepth < 0) return { nodes: [], edges: [], deferredNodeIds: [], hiddenNodeCount: 0, hiddenEdgeCount: 0 };

  const traversable = edges.filter((edge) => edge.relation !== "import" && nodeMap.has(edge.source) && nodeMap.has(edge.target));
  const outgoing = new Map<string, CodeEdge[]>();
  for (const edge of traversable) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  for (const items of outgoing.values()) items.sort((a, b) => DISPLAY_RELATION_PRIORITY[a.relation] - DISPLAY_RELATION_PRIORITY[b.relation]
    || a.target.localeCompare(b.target) || (a.line ?? 0) - (b.line ?? 0));

  const selected = new Set<string>();
  const deferred = new Set<string>();
  const traversalEdges = new Set<string>();
  const visit = (nodeId: string, depth: number, componentHops: number): void => {
    if (selected.has(nodeId)) return;
    if (selected.size >= maxNodes) { deferred.add(nodeId); return; }
    selected.add(nodeId);
    const candidates = outgoing.get(nodeId) ?? [];
    if (depth >= maxDepth) {
      candidates.forEach((edge) => { if (!selected.has(edge.target)) deferred.add(edge.target); });
      return;
    }
    for (const edge of candidates) {
      if (selected.has(edge.target)) continue;
      const nextComponentHops = edge.relation === "component" ? componentHops + 1 : 0;
      if (edge.relation === "component" && componentHops >= 1 && !expanded.has(nodeId)) {
        deferred.add(edge.target);
        continue;
      }
      if (selected.size >= maxNodes) { deferred.add(edge.target); continue; }
      traversalEdges.add(displayEdgeKey(edge));
      visit(edge.target, depth + 1, nextComponentHops);
    }
  };
  visit(startNodeId, 0, 0);

  const candidateGroups = aggregateDisplayEdges(traversable.filter((edge) => selected.has(edge.source) && selected.has(edge.target)))
    .sort((a, b) => Number(traversalEdges.has(displayEdgeKey(b))) - Number(traversalEdges.has(displayEdgeKey(a)))
      || Number(expanded.has(b.source)) - Number(expanded.has(a.source))
      || DISPLAY_RELATION_PRIORITY[a.relation] - DISPLAY_RELATION_PRIORITY[b.relation]
      || a.id.localeCompare(b.id));
  const visibleEdges = candidateGroups.slice(0, maxEdges);
  const boundaryGroups = aggregateDisplayEdges(traversable.filter((edge) => selected.has(edge.source) && !selected.has(edge.target)));
  const visibleIds = new Set(visibleEdges.flatMap((edge) => [edge.source, edge.target]));
  visibleIds.add(startNodeId);
  const visibleNodes = nodes.filter((node) => selected.has(node.id) && visibleIds.has(node.id));
  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    deferredNodeIds: [...deferred].filter((id) => !selected.has(id)),
    hiddenNodeCount: deferred.size + Math.max(0, selected.size - visibleNodes.length),
    hiddenEdgeCount: boundaryGroups.length + Math.max(0, candidateGroups.length - visibleEdges.length),
  };
}

export function traverseGraph(
  startNodeId: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
  maxDepth = 5,
): TraversalResult {
  if (maxDepth < 0) return { nodes: [], edges: [] };
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(startNodeId)) return { nodes: [], edges: [] };

  const adjacency = new Map<string, CodeEdge[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge]);

  const visited = new Set<string>();
  const selectedEdges = new Map<string, CodeEdge>();

  function dfs(nodeId: string, depth: number): void {
    if (visited.has(nodeId) || depth > maxDepth) return;
    visited.add(nodeId);
    if (depth === maxDepth) return;

    for (const edge of adjacency.get(nodeId) ?? []) {
      if (!nodeMap.has(edge.target)) continue;
      selectedEdges.set(edge.id, edge);
      if (!visited.has(edge.target)) dfs(edge.target, depth + 1);
    }
  }

  dfs(startNodeId, 0);
  return {
    nodes: [...visited].flatMap((id) => (nodeMap.has(id) ? [nodeMap.get(id)!] : [])),
    edges: [...selectedEdges.values()].filter((edge) => visited.has(edge.source) && visited.has(edge.target)),
  };
}

export function traverseGraphAround(
  startNodeId: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
  maxDepth = 5,
): TraversalResult {
  if (maxDepth < 0) return { nodes: [], edges: [] };
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(startNodeId)) return { nodes: [], edges: [] };

  const adjacency = new Map<string, CodeEdge[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge]);
  }

  const visited = new Set<string>();
  function dfs(nodeId: string, depth: number): void {
    if (visited.has(nodeId) || depth > maxDepth) return;
    visited.add(nodeId);
    if (depth === maxDepth) return;
    for (const edge of adjacency.get(nodeId) ?? []) {
      const nextId = edge.source === nodeId ? edge.target : edge.source;
      if (nodeMap.has(nextId) && !visited.has(nextId)) dfs(nextId, depth + 1);
    }
  }

  dfs(startNodeId, 0);
  return {
    nodes: nodes.filter((node) => visited.has(node.id)),
    edges: edges.filter((edge) => visited.has(edge.source) && visited.has(edge.target)),
  };
}

/** Priority-guided DFS: query neighbours, filter by relation relevance, track state,
 * backtrack through the stack, then validate that every selected edge has real endpoints. */
export function traceRelevantGraph(
  startNodeId: string,
  nodes: CodeNode[],
  edges: CodeEdge[],
  maxDepth = 5,
  maxNodes = 40,
): TraversalResult {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(startNodeId) || maxDepth < 0 || maxNodes < 1) return { nodes: [], edges: [], deferredNodeIds: [] };
  const relationPriority: Record<CodeEdge["relation"], number> = { api: 0, call: 1, component: 2, reference: 3, import: 4 };
  const adjacency = new Map<string, CodeEdge[]>();
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge]);
  }
  const state = new Map<string, "New" | "Tracing" | "Used">(nodes.map((node) => [node.id, "New"]));
  const selected = new Map<string, CodeEdge>();
  const deferred = new Set<string>();
  const stack: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (state.get(current.id) !== "New") continue;
    if ([...state.values()].filter((value) => value === "Used").length >= maxNodes) { deferred.add(current.id); continue; }
    state.set(current.id, "Tracing");
    const candidates = (adjacency.get(current.id) ?? []).map((edge) => ({
      edge, next: edge.source === current.id ? edge.target : edge.source,
    })).sort((a, b) => relationPriority[a.edge.relation] - relationPriority[b.edge.relation]
      || Number(b.edge.source === current.id) - Number(a.edge.source === current.id));
    if (current.depth < maxDepth) {
      for (const item of candidates) {
        if (state.get(item.next) === "Used") selected.set(item.edge.id, item.edge);
      }
      for (const item of [...candidates].reverse()) {
        if (state.get(item.next) !== "New") continue;
        if (stack.length + [...state.values()].filter((value) => value !== "New").length >= maxNodes) deferred.add(item.next);
        else { selected.set(item.edge.id, item.edge); stack.push({ id: item.next, depth: current.depth + 1 }); }
      }
    } else for (const item of candidates) if (state.get(item.next) === "New") deferred.add(item.next);
    state.set(current.id, "Used");
  }
  const usedIds = new Set([...state].filter(([, value]) => value === "Used").map(([id]) => id));
  return {
    nodes: nodes.filter((node) => usedIds.has(node.id)),
    edges: [...selected.values()].filter((edge) => usedIds.has(edge.source) && usedIds.has(edge.target)),
    deferredNodeIds: [...deferred].filter((id) => !usedIds.has(id)),
    traversalStates: Object.fromEntries([...state].filter(([, value]) => value !== "New")),
  };
}
