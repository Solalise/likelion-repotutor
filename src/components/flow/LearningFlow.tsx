"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { LearningEdge, LearningNode } from "@/types/learning";
import { LearningNodeCard, type LearningFlowNode } from "./LearningNodeCard";

const nodeTypes: NodeTypes = { learning: LearningNodeCard };
const POSITIONS: Record<string, { x: number; y: number }> = {
  LoginPage: { x: 300, y: 0 },
  handleLogin: { x: 300, y: 155 },
  login: { x: 300, y: 310 },
  POST: { x: 300, y: 465 },
  findUser: { x: 300, y: 620 },
  "learning:condition:user-exists": { x: 300, y: 775 },
  "learning:end:login-failure": { x: 65, y: 955 },
  "learning:end:login-success": { x: 535, y: 955 },
};

function graphPositions(items: LearningNode[], edges: LearningEdge[]): Map<string, { x: number; y: number }> {
  if (items.some((node) => node.technicalName === "LoginPage")) {
    return new Map(items.map((node, index) => [node.id, POSITIONS[node.technicalName ?? node.id] ?? { x: 300, y: index * 165 }]));
  }
  const ids = new Set(items.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map(items.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const levels = new Map<string, number>();
  const queue = items.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  if (queue.length === 0 && items[0]) queue.push(items[0].id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levels.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      if (!levels.has(next)) { levels.set(next, level + 1); queue.push(next); }
    }
  }
  for (const node of items) if (!levels.has(node.id)) levels.set(node.id, Math.min(4, levels.size));
  const groups = new Map<number, LearningNode[]>();
  for (const node of items) {
    const level = levels.get(node.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, group] of groups) {
    group.forEach((node, index) => positions.set(node.id, {
      x: 310 + (index - (group.length - 1) / 2) * 285,
      y: level * 175,
    }));
  }
  return positions;
}

function createNodes(items: LearningNode[], edges: LearningEdge[]): LearningFlowNode[] {
  const positions = graphPositions(items, edges);
  return items.map((item, index) => ({
    id: item.id,
    type: "learning",
    position: positions.get(item.id) ?? { x: 300, y: index * 165 },
    data: { learning: item },
  }));
}

function createEdges(items: LearningEdge[]): Edge[] {
  const colorFor = (relation: LearningEdge["relation"]) => relation === "branch" ? "#8a72c7"
    : relation === "import" ? "#8793a3"
      : relation === "component" ? "#5965d8"
        : relation === "reference" ? "#3c82a6"
        : relation === "request" ? "#d08332" : "#2b9470";
  return items.map((item) => ({
    id: item.id,
    source: item.source,
    target: item.target,
    label: item.label,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: colorFor(item.relation) },
    style: {
      stroke: colorFor(item.relation),
      strokeWidth: 1.7,
    },
    labelStyle: { fill: "#5f6e69", fontSize: 10, fontWeight: 650 },
    labelBgStyle: { fill: "#f6faf8", fillOpacity: 0.95 },
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 5,
  }));
}

interface LearningFlowProps {
  learningNodes: LearningNode[];
  learningEdges: LearningEdge[];
  onSelect: (nodeId: string) => void;
}

export function LearningFlow({ learningNodes, learningEdges, onSelect }: LearningFlowProps) {
  const initialNodes = useMemo(() => createNodes(learningNodes, learningEdges), [learningEdges, learningNodes]);
  const initialEdges = useMemo(() => createEdges(learningEdges), [learningEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState<LearningFlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [instance, setInstance] = useState<ReactFlowInstance<LearningFlowNode>>();

  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);
  useEffect(() => {
    if (!instance || initialNodes.length === 0) return;
    const frame = requestAnimationFrame(() => void instance.fitView({ padding: 0.28, duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [initialNodes, instance]);

  const handleClick: NodeMouseHandler<LearningFlowNode> = (_, node) => onSelect(node.id);
  return (
    <ReactFlow<LearningFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleClick}
      onInit={setInstance}
      fitView
      fitViewOptions={{ padding: 0.28 }}
      minZoom={0.35}
      maxZoom={1.5}
      nodesDraggable
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#dfe7e3" gap={26} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
