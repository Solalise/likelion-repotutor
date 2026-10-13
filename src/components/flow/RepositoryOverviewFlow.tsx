"use client";

import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, useEdgesState, useNodesState, type Edge, type Node, type NodeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import type { RepositoryOverviewEdge, RepositoryOverviewNode } from "@/types/overview";

const COLORS: Record<RepositoryOverviewNode["type"], string> = {
  project: "#087c58", module: "#5965d8", file: "#607086", symbol: "#19a974",
};

function layoutNodes(items: RepositoryOverviewNode[], selectedId?: string): Node[] {
  const hasDetails = items.some((item) => item.type === "file" || item.type === "symbol");
  const groups = new Map<RepositoryOverviewNode["type"], RepositoryOverviewNode[]>();
  for (const item of items) groups.set(item.type, [...(groups.get(item.type) ?? []), item]);
  const positions = new Map<string, { x: number; y: number }>();
  if (!hasDetails) {
    const project = groups.get("project")?.[0];
    if (project) positions.set(project.id, { x: 410, y: 0 });
    (groups.get("module") ?? []).forEach((item, index) => positions.set(item.id, { x: (index % 4) * 250, y: 150 + Math.floor(index / 4) * 135 }));
  } else {
    const order: RepositoryOverviewNode["type"][] = ["project", "module", "file", "symbol"];
    order.forEach((type, column) => (groups.get(type) ?? []).forEach((item, row) => positions.set(item.id, { x: column * 265, y: row * 115 })));
  }
  return items.map((item) => ({
    id: item.id,
    position: positions.get(item.id) ?? { x: 0, y: 0 },
    selected: item.id === selectedId,
    data: { label: <div className="overview-node-label"><strong>{item.name}</strong><span>{item.subtitle}</span>{item.expandable && <small>{item.expanded ? "접기" : "하위 구조 펼치기"}</small>}</div> },
    style: {
      width: item.type === "project" ? 220 : 205,
      padding: "11px 13px",
      borderRadius: 11,
      border: `1.5px solid ${COLORS[item.type]}`,
      borderLeft: `5px solid ${COLORS[item.type]}`,
      background: "#fff",
      color: "#1d2b39",
      boxShadow: item.id === selectedId ? `0 0 0 3px ${COLORS[item.type]}22, 0 9px 25px rgba(25,40,55,.1)` : "0 7px 20px rgba(25,40,55,.07)",
    },
  }));
}

function layoutEdges(items: RepositoryOverviewEdge[]): Edge[] {
  const labels: Record<RepositoryOverviewEdge["relation"], string> = {
    contains: "포함", import: "Import", call: "호출", component: "컴포넌트", reference: "참조", api: "API",
  };
  return items.map((item) => ({
    id: item.id, source: item.source, target: item.target,
    label: `${labels[item.relation]}${item.count > 1 ? ` ${item.count}` : ""}`,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: item.relation === "contains" ? "#aab4bf" : "#4b8e78" },
    style: { stroke: item.relation === "contains" ? "#b6c0ca" : "#4b8e78", strokeWidth: item.relation === "contains" ? 1.1 : 1.7, strokeDasharray: item.relation === "contains" ? "5 4" : undefined },
    labelStyle: { fill: "#667580", fontSize: 8 },
    labelBgStyle: { fill: "#f8faf9", fillOpacity: .94 },
  }));
}

interface RepositoryOverviewFlowProps {
  overviewNodes: RepositoryOverviewNode[];
  overviewEdges: RepositoryOverviewEdge[];
  selectedId?: string;
  onSelect: (nodeId: string) => void;
}

export function RepositoryOverviewFlow({ overviewNodes, overviewEdges, selectedId, onSelect }: RepositoryOverviewFlowProps) {
  const initialNodes = useMemo(() => layoutNodes(overviewNodes, selectedId), [overviewNodes, selectedId]);
  const initialEdges = useMemo(() => layoutEdges(overviewEdges), [overviewEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [instance, setInstance] = useState<ReactFlowInstance>();
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);
  useEffect(() => {
    if (!instance || initialNodes.length === 0) return;
    const frame = requestAnimationFrame(() => void instance.fitView({ padding: .22, duration: 220 }));
    return () => cancelAnimationFrame(frame);
  }, [initialNodes, instance]);
  const handleClick: NodeMouseHandler = (_, node) => onSelect(node.id);
  return <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={handleClick} onInit={setInstance} fitView fitViewOptions={{ padding: .22 }} minZoom={.18} maxZoom={1.6} proOptions={{ hideAttribution: true }}>
    <Background color="#dce3e0" gap={25} size={1} />
    <MiniMap pannable zoomable />
    <Controls showInteractive={false} />
  </ReactFlow>;
}
