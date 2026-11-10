"use client";

import { useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Node, type NodeProps, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildCodeFlowLayout } from "@/lib/graph/codeFlowLayout";
import type { CodeNode } from "@/types/analysis";
import type { BehaviorGraphResponse, BehaviorCfgResponse, BehaviorNodeDetail } from "@/types/behaviorQuery";
import { behaviorNodeTitle, selectedAuxiliaryEdges, splitBehaviorGraph } from "./behaviorPresentation";

export const kindLabels: Record<string, string> = { screen: "화면 진입점", server: "서버 진입점", event: "이벤트 바인딩", function: "함수", "http-request": "HTTP 요청", "data-access": "DB 접근 후보", "response-creation": "응답 생성", "response-return": "응답 반환", if: "조건 분기", return: "반환", throw: "예외", unsupported: "미지원 구간", entry: "함수 시작", "normal-exit": "함수 종료", "return-exit": "반환 종료", "throw-exit": "예외 종료", "analysis-boundary": "분석 경계" };
const relationLabels: Record<string, string> = { call: "호출 가능 관계", "event-binding": "이벤트 연결", "event-handler": "핸들러 연결", "api-request": "API 요청 관계", "api-route": "HTTP 경계", "contains-site": "코드 포함", "server-scope-reference": "서버 분석 범위", reference: "참조 전달", component: "컴포넌트 연결", next: "다음 문장", true: "Yes", false: "No", return: "반환", throw: "예외", exception: "가능한 예외", finally: "finally", resume: "종료 재개", unknown: "미확인 경로" };
type CardNode = Node<{ label: string; kind: string; status: string; note?: string }, "behavior">;
function Card({ data, selected }: NodeProps<CardNode>) {
  return <div className={`behavior-node ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left} /><small>{kindLabels[data.kind] ?? data.kind}</small>
    <strong>{data.label}</strong><span>{data.status}</span>{data.note && <small>{data.note}</small>}
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { behavior: Card };

/** Reuses the existing graph layout only for coordinates. Edges/semantics come exclusively from the API. */
export function behaviorDiagram(graph: BehaviorGraphResponse, cfg?: BehaviorCfgResponse, detail?: BehaviorNodeDetail) {
  const presentation = splitBehaviorGraph(graph);
  const records = cfg ? cfg.nodes.map(node => {
    const statement = cfg.statements.find(item => item.id === node.statementId);
    return { id: node.id, kind: statement?.kind ?? node.kind, label: statement?.condition ?? kindLabels[statement?.kind ?? node.kind] ?? node.kind, status: node.reachability, note: statement?.unsupportedReason };
  }) : presentation.mainNodes.map(node => ({ id: node.id, kind: node.kind, label: behaviorNodeTitle(node, detail, graph), status: node.confidence, note: node.cfgSummary.conditions ? `조건 분기 ${node.cfgSummary.conditions}개 · 내부 조회 가능` : node.reason }));
  const sourceEdges = cfg ? cfg.edges.map(edge => ({ ...edge, relation: edge.kind, confidence: edge.certainty, conditional: false })) : presentation.mainEdges;
  const ids = new Set(records.map(node => node.id));
  const edges: Edge[] = sourceEdges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, type: "smoothstep",
    label: `${relationLabels[edge.relation] ?? edge.relation}${edge.conditional ? " · 조건 경로" : ""}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#777e55" },
    style: { stroke: "#777e55", strokeDasharray: ["contains-site", "server-scope-reference", "reference"].includes(edge.relation) || !["confirmed", "structural"].includes(edge.confidence) ? "5 5" : undefined },
    labelStyle: { fontSize: 10, fill: "#505442" }, labelBgStyle: { fill: "#faf9f4" },
  }));
  const layoutNodes: CodeNode[] = records.map(node => ({ id: node.id, name: node.label, type: "function", filePath: "" }));
  const layout = buildCodeFlowLayout(layoutNodes, edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, relation: "call" as const })));
  const positions = new Map(layout.nodes.map(node => [node.node.id, node.position]));
  return { nodes: records.map(node => ({ id: node.id, type: "behavior" as const, position: positions.get(node.id)!, data: node, width: 248 })), edges };
}
export function BehaviorGraph({ graph, cfg, detail, selectedId, onSelect }: { graph: BehaviorGraphResponse; cfg?: BehaviorCfgResponse; detail?: BehaviorNodeDetail; selectedId?: string; onSelect: (id: string) => void }) {
  const diagram = useMemo(() => behaviorDiagram(graph, cfg, detail), [graph, cfg, detail]);
  const split = useMemo(() => splitBehaviorGraph(graph), [graph]);
  const anchor = graph.nodes.find(node => node.id === selectedId) ?? graph.nodes.find(node => node.id === graph.rootId);
  const auxiliary = anchor ? selectedAuxiliaryEdges(graph, anchor.id) : [];
  return <div className="behavior-graph-view">
    {!cfg && <div className="behavior-relation-tools"><span>메인 구조 {split.mainNodes.length}노드</span><span> 보조 관계 {split.auxiliaryEdges.length}개 · 보조 노드 {split.auxiliaryNodes.length}개 접힘</span>
      <small>호출 가능·컴포넌트 연결입니다. 실제 실행 사실이나 순서를 뜻하지 않습니다.</small>
      <details><summary>선택 노드의 보조 관계 보기 · {auxiliary.length}개</summary>
        <p>{anchor ? behaviorNodeTitle(anchor, detail, graph) : "선택 노드 없음"}에 직접 연결된 관계만 표시합니다. 다른 노드를 선택하면 그 노드 주변을 확인할 수 있습니다.</p>
        {auxiliary.length === 0 && <p>이 노드에 직접 연결된 보조 관계가 없습니다. 메인 노드를 선택해 주세요.</p>}
        <div className="behavior-auxiliary-list">{auxiliary.map(edge => {
          const other = graph.nodes.find(node => node.id === (edge.source === anchor?.id ? edge.target : edge.source));
          return <div key={edge.id}><small>{edge.source === anchor?.id ? "나가는 관계" : "들어오는 관계"} · {relationLabels[edge.relation] ?? edge.relation} · {edge.confidence}</small>
            {other ? <button type="button" aria-pressed={other.id === selectedId} onClick={() => onSelect(other.id)}>{behaviorNodeTitle(other, detail, graph)} · 코드 확인</button> : <span>상대 노드는 현재 API 페이지에 없습니다.</span>}
          </div>;
        })}</div>
      </details>
      {split.auxiliaryEdges.length > 0 && <small>현재 API 데이터 안에서 접은 관계입니다. 서버의 화면 제한·원본 분석 잘림과는 별개입니다.</small>}
    </div>}
    <div className="behavior-main-canvas"><ReactFlow<CardNode> key={`${graph.featureId}:${cfg?.nodeId ?? "outer"}`} nodes={diagram.nodes.map(node => ({ ...node, selected: node.id === selectedId }))} edges={diagram.edges} nodeTypes={nodeTypes}
    onNodeClick={(_, node) => onSelect(node.id)} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.15} maxZoom={1.8}>
    <Background color="#dcded0" gap={22} /><Controls showInteractive={false} />
  </ReactFlow></div></div>;
}
