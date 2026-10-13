"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CodeEdge, CodeNode } from "@/types/analysis";

const NODE_COLORS: Record<CodeNode["type"], string> = {
  file: "#607086",
  function: "#19a974",
  component: "#5965d8",
  api: "#e99237",
};

function layoutNodes(nodes: CodeNode[]): Node[] {
  const grouped = nodes.reduce<Record<CodeNode["type"], CodeNode[]>>(
    (result, node) => ({ ...result, [node.type]: [...result[node.type], node] }),
    { file: [], component: [], function: [], api: [] },
  );
  const order: CodeNode["type"][] = ["file", "component", "function", "api"];
  const positions = new Map<string, { x: number; y: number }>();
  order.forEach((type, column) => grouped[type].forEach((node, row) => positions.set(node.id, { x: column * 255, y: row * 118 })));

  return nodes.map((node) => ({
    id: node.id,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { label: node.name },
    style: {
      background: "#fff",
      border: `1.5px solid ${NODE_COLORS[node.type]}`,
      borderLeft: `5px solid ${NODE_COLORS[node.type]}`,
      borderRadius: 12,
      boxShadow: "0 8px 24px rgba(19, 32, 48, .08)",
      color: "#172234",
      fontSize: 13,
      fontWeight: 650,
      padding: "13px 16px",
      width: 190,
    },
  }));
}

function layoutEdges(edges: CodeEdge[]): Edge[] {
  const relationLabels: Record<CodeEdge["relation"], string> = {
    import: "불러오기", call: "함수 호출", component: "컴포넌트 표시", reference: "콜백 연결", api: "API 요청",
  };
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: relationLabels[edge.relation],
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.relation === "call" ? "#19a974" : "#94a0b2" },
    style: { stroke: edge.relation === "call" ? "#19a974" : "#94a0b2", strokeWidth: 1.5 },
    labelStyle: { fill: "#6e7a8a", fontSize: 10 },
  }));
}

interface CodeFlowProps {
  codeNodes: CodeNode[];
  codeEdges: CodeEdge[];
  onSelect: (nodeId: string) => void;
}

export function CodeFlow({ codeNodes, codeEdges, onSelect }: CodeFlowProps) {
  const initialNodes = useMemo(() => layoutNodes(codeNodes), [codeNodes]);
  const initialEdges = useMemo(() => layoutEdges(codeEdges), [codeEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);

  const handleNodeClick: NodeMouseHandler = (_, node) => onSelect(node.id);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.22 }}
      minZoom={0.25}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d8dee8" gap={24} size={1} />
      <MiniMap pannable zoomable nodeColor={(node) => String(node.style?.borderColor ?? "#8390a2")} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
