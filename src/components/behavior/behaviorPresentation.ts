import type { BehaviorGraphResponse, BehaviorNodeDetail, QueryEdge, QueryNode } from "@/types/behaviorQuery";

const MAIN_RELATIONS = new Set(["call", "component", "api-request", "api-route", "event-binding", "event-handler"]);

/** Presentation scope only. Confirmed means a code relationship, never an observed execution. */
export function splitBehaviorGraph(graph: BehaviorGraphResponse) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const candidates = graph.edges.filter(edge => MAIN_RELATIONS.has(edge.relation) && edge.confidence === "confirmed"
    && ["static-relation", "http-boundary"].includes(edge.semantics)
    && nodes.get(edge.source)?.confidence === "confirmed" && nodes.get(edge.target)?.confidence === "confirmed");
  const reached = new Set(nodes.has(graph.rootId) ? [graph.rootId] : []);
  const outgoing = new Map<string, QueryEdge[]>();
  for (const edge of candidates) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const queue = [...reached];
  for (let i = 0; i < queue.length; i++) for (const edge of outgoing.get(queue[i]) ?? []) {
    if (!reached.has(edge.target)) { reached.add(edge.target); queue.push(edge.target); }
  }
  const mainEdges = candidates.filter(edge => reached.has(edge.source) && reached.has(edge.target));
  const mainIds = new Set(mainEdges.map(edge => edge.id));
  return {
    mainNodes: graph.nodes.filter(node => reached.has(node.id)), mainEdges,
    auxiliaryEdges: graph.edges.filter(edge => !mainIds.has(edge.id)),
    auxiliaryNodes: graph.nodes.filter(node => !reached.has(node.id)),
  };
}

export function selectedAuxiliaryEdges(graph: BehaviorGraphResponse, selectedId: string) {
  if (!graph.nodes.some(node => node.id === selectedId)) return [];
  return splitBehaviorGraph(graph).auxiliaryEdges.filter(edge => edge.source === selectedId || edge.target === selectedId);
}

export function behaviorNodeTitle(node: QueryNode, detail?: BehaviorNodeDetail, graph?: BehaviorGraphResponse): string {
  const match = /callback@(\d+):(\d+)/.exec(node.label);
  const wrapped = node.label.endsWith(".callback");
  if (!match && !wrapped) return node.label;
  const ownDetail = detail?.node.id === node.id ? detail : undefined;
  const binding = ownDetail?.bindings.items.find(item => typeof item.event === "string" && typeof item.targetCodeNodeId === "string" && ownDetail.sourceCodeNodeIds.includes(item.targetCodeNodeId));
  const file = ownDetail?.code?.filePath.split(/[\\/]/).at(-1);
  const line = match?.[1] ?? (ownDetail?.code?.offset === 0 ? ownDetail.code.startLine : undefined);
  const location = file && line ? `${file}:${line}` : match ? `${match[1]}줄:${match[2]}` : undefined;
  const passed = graph?.edges.some(edge => edge.relation === "reference" && edge.target === node.id);
  const context = binding ? `${String(binding.event)}에 전달된 콜백` : wrapped ? `${node.label.slice(0, -9)}에 전달된 콜백` : passed ? "전달된 콜백" : "콜백 함수";
  return `${context}${location ? ` · ${location}` : " · 위치 상세에서 확인"}`;
}
