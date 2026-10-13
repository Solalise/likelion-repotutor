import type { CodeEdge, CodeNode, TraversalResult } from "@/types/analysis";

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
