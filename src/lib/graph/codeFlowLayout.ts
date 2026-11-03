import type { CodeEdge, CodeNode } from "@/types/analysis";

export type CodeLayer = "ui" | "event" | "api-client" | "api-route" | "service" | "data" | "logic" | "file";

export interface CodeFlowLayoutNode {
  node: CodeNode;
  layer: CodeLayer;
  role: string;
  stage: number;
  position: { x: number; y: number };
}

export interface CodeFlowLane {
  layer: CodeLayer;
  label: string;
  y: number;
  height: number;
}

export interface CodeFlowLayout {
  nodes: CodeFlowLayoutNode[];
  lanes: CodeFlowLane[];
  width: number;
  height: number;
}

export const CODE_NODE_WIDTH = 248;
export const CODE_NODE_HEIGHT = 108;

const LAYER_ORDER: CodeLayer[] = ["ui", "event", "api-client", "api-route", "service", "data", "logic", "file"];
const LAYER_LABELS: Record<CodeLayer, string> = {
  ui: "UI / Component",
  event: "Event Handler",
  "api-client": "API Client",
  "api-route": "API Route",
  service: "Service / Domain",
  data: "Repository / Database",
  logic: "Application Logic",
  file: "File / Module",
};

function hasPath(path: string, segment: RegExp): boolean {
  return segment.test(path.replaceAll("\\", "/"));
}

function isEventEdge(edge: CodeEdge): boolean {
  return edge.relation === "reference" && (/\bon[A-Z]\w*\s*=/.test(edge.evidence ?? "") || /callback/i.test(edge.evidence ?? ""));
}

export function classifyCodeNode(node: CodeNode, edges: CodeEdge[]): { layer: CodeLayer; role: string } {
  const incoming = edges.filter((edge) => edge.target === node.id);
  const outgoing = edges.filter((edge) => edge.source === node.id);
  if (node.type === "file") return { layer: "file", role: "Source file" };
  if (node.type === "api") return { layer: "api-route", role: "API route handler" };
  if (node.type === "component") return { layer: "ui", role: "React component" };
  if (incoming.some(isEventEdge) || /^(?:handle|on)[A-Z_]/.test(node.name)) return { layer: "event", role: "Event / callback" };
  if (outgoing.some((edge) => edge.relation === "api") || hasPath(node.filePath, /(?:^|\/)(?:api-clients?|clients?)(?:\/|$)/i)) {
    return { layer: "api-client", role: "API client" };
  }
  if (hasPath(node.filePath, /(?:^|\/)(?:repositories?|models?|database|db|persistence)(?:\/|$)/i)) {
    return { layer: "data", role: "Data access" };
  }
  if (hasPath(node.filePath, /(?:^|\/)(?:services?|use-?cases?|domain)(?:\/|$)/i)) {
    return { layer: "service", role: "Service function" };
  }
  return { layer: "logic", role: node.type === "function" ? "Function" : node.type };
}

/** Assigns a stable left-to-right execution stage. Strongly connected nodes share a stage. */
function executionStages(nodes: CodeNode[], edges: CodeEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    adjacency.get(edge.source)!.push(edge.target);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    indices.set(id, index);
    lowLinks.set(id, index++);
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(target)!));
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component);
  };
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);

  const componentOf = new Map<string, number>();
  components.forEach((component, componentIndex) => component.forEach((id) => componentOf.set(id, componentIndex)));
  const next = new Map<number, Set<number>>(components.map((_, componentIndex) => [componentIndex, new Set()]));
  const indegree = new Map<number, number>(components.map((_, componentIndex) => [componentIndex, 0]));
  for (const edge of edges) {
    const source = componentOf.get(edge.source);
    const target = componentOf.get(edge.target);
    if (source === undefined || target === undefined || source === target || next.get(source)!.has(target)) continue;
    next.get(source)!.add(target);
    indegree.set(target, indegree.get(target)! + 1);
  }
  const stage = new Map<number, number>(components.map((_, componentIndex) => [componentIndex, 0]));
  const queue = [...indegree].filter(([, count]) => count === 0).map(([componentIndex]) => componentIndex);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const target of next.get(current)!) {
      stage.set(target, Math.max(stage.get(target)!, stage.get(current)! + 1));
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return new Map(nodes.map((node) => [node.id, stage.get(componentOf.get(node.id)!) ?? 0]));
}

export function buildCodeFlowLayout(nodes: CodeNode[], edges: CodeEdge[]): CodeFlowLayout {
  if (nodes.length === 0) return { nodes: [], lanes: [], width: 0, height: 0 };
  const visibleIds = new Set(nodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const stages = executionStages(nodes, visibleEdges);
  const classified = new Map(nodes.map((node) => [node.id, classifyCodeNode(node, visibleEdges)]));
  const activeLayers = LAYER_ORDER.filter((layer) => nodes.some((node) => classified.get(node.id)!.layer === layer));
  const buckets = new Map<string, CodeNode[]>();
  for (const node of nodes) {
    const key = `${classified.get(node.id)!.layer}:${stages.get(node.id) ?? 0}`;
    buckets.set(key, [...(buckets.get(key) ?? []), node]);
  }
  const inputOrder = new Map(nodes.map((node, nodeIndex) => [node.id, nodeIndex]));
  for (const items of buckets.values()) items.sort((a, b) => {
    const neighborOrder = (node: CodeNode): number => {
      const neighbors = visibleEdges.flatMap((edge) => edge.target === node.id ? [edge.source] : edge.source === node.id ? [edge.target] : []);
      return neighbors.length === 0 ? inputOrder.get(node.id)! : neighbors.reduce((sum, id) => sum + (inputOrder.get(id) ?? 0), 0) / neighbors.length;
    };
    return neighborOrder(a) - neighborOrder(b) || a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name);
  });

  const columnGap = nodes.length <= 5 ? 96 : nodes.length <= 20 ? 72 : nodes.length <= 60 ? 54 : 42;
  const rowGap = nodes.length <= 20 ? 22 : 16;
  const laneGap = nodes.length <= 20 ? 22 : 14;
  const leftInset = 34;
  const topInset = 34;
  const laneLabelHeight = 30;
  let laneY = topInset;
  const lanes: CodeFlowLane[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  for (const layer of activeLayers) {
    const maxStack = Math.max(1, ...[...buckets].filter(([key]) => key.startsWith(`${layer}:`)).map(([, items]) => items.length));
    const height = laneLabelHeight + maxStack * CODE_NODE_HEIGHT + (maxStack - 1) * rowGap + 24;
    lanes.push({ layer, label: LAYER_LABELS[layer], y: laneY, height });
    for (const [key, items] of buckets) {
      if (!key.startsWith(`${layer}:`)) continue;
      const stage = Number(key.slice(layer.length + 1));
      items.forEach((node, row) => positions.set(node.id, {
        x: leftInset + stage * (CODE_NODE_WIDTH + columnGap),
        y: laneY + laneLabelHeight + row * (CODE_NODE_HEIGHT + rowGap),
      }));
    }
    laneY += height + laneGap;
  }
  const maxStage = Math.max(...nodes.map((node) => stages.get(node.id) ?? 0));
  const width = leftInset * 2 + (maxStage + 1) * CODE_NODE_WIDTH + maxStage * columnGap;
  return {
    nodes: nodes.map((node) => ({
      node,
      ...classified.get(node.id)!,
      stage: stages.get(node.id) ?? 0,
      position: positions.get(node.id)!,
    })),
    lanes,
    width,
    height: laneY - laneGap + topInset,
  };
}
