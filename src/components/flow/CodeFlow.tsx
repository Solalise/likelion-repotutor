"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CodeNodeCard, type CodeFlowNode } from "./CodeNodeCard";
import { buildCodeFlowLayout, CODE_NODE_WIDTH } from "@/lib/graph/codeFlowLayout";
import type { CodeEdge, CodeNode, CodeRelation } from "@/types/analysis";

const nodeTypes: NodeTypes = { code: CodeNodeCard };
const RELATION_COLORS: Record<CodeRelation, string> = {
  import: "#8793a3",
  call: "#15966a",
  component: "#655fd2",
  reference: "#3184a5",
  api: "#d47a24",
};

function edgeLabel(edge: CodeEdge): string {
  const count = edge.occurrences?.length ?? 1;
  const suffix = count > 1 ? ` ×${count}` : "";
  if (edge.relation === "call") return `Direct call${suffix}`;
  if (edge.relation === "component") return `Component${suffix}`;
  if (edge.relation === "api") return `API request${suffix}`;
  if (edge.relation === "import") return `Import${suffix}`;
  if (/\bon[A-Z]\w*\s*=/.test(edge.evidence ?? "")) return `React event${suffix}`;
  if (/nested declaration/i.test(edge.evidence ?? "")) return `Nested function${suffix}`;
  return `Callback / reference${suffix}`;
}

function layoutEdges(edges: CodeEdge[]): Edge[] {
  return edges.map((edge) => {
    const color = RELATION_COLORS[edge.relation];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edgeLabel(edge),
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      pathOptions: { borderRadius: 12, offset: 18 },
      style: {
        stroke: color,
        strokeWidth: edge.relation === "api" ? 2.4 : 1.8,
        strokeDasharray: edge.relation === "import" ? "3 5" : edge.relation === "reference" || edge.confidence === "inferred" ? "7 4" : undefined,
      },
      labelStyle: { fill: color, fontSize: 10, fontWeight: 700 },
      labelBgStyle: { fill: "#fff", fillOpacity: 0.94 },
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 5,
      zIndex: 2,
    };
  });
}

interface CodeFlowProps {
  codeNodes: CodeNode[];
  codeEdges: CodeEdge[];
  selectedId?: string;
  onSelect: (nodeId: string) => void;
}

export function CodeFlow({ codeNodes, codeEdges, selectedId, onSelect }: CodeFlowProps) {
  const layout = useMemo(() => buildCodeFlowLayout(codeNodes, codeEdges), [codeNodes, codeEdges]);
  const initialNodes = useMemo<CodeFlowNode[]>(() => layout.nodes.map(({ node, position, layer, role }) => ({
    id: node.id,
    type: "code",
    position,
    selected: node.id === selectedId,
    width: CODE_NODE_WIDTH,
    data: {
      codeNode: node,
      layer,
      role,
      relations: [...new Set(codeEdges.filter((edge) => edge.source === node.id || edge.target === node.id).map((edge) => edge.relation))],
    },
  })), [codeEdges, layout.nodes, selectedId]);
  const initialEdges = useMemo(() => layoutEdges(codeEdges), [codeEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CodeFlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [instance, setInstance] = useState<ReactFlowInstance<CodeFlowNode>>();
  const fitMaxZoom = codeNodes.length <= 5 ? 1.12 : codeNodes.length <= 20 ? 0.98 : 0.82;

  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);
  useEffect(() => {
    if (!instance || nodes.length === 0) return;
    const frame = requestAnimationFrame(() => void instance.fitView({ padding: 0.12, minZoom: 0.28, maxZoom: fitMaxZoom, duration: 280 }));
    return () => cancelAnimationFrame(frame);
  }, [fitMaxZoom, instance, nodes.length, layout.width, layout.height]);

  const handleNodeClick: NodeMouseHandler<CodeFlowNode> = (_, node) => onSelect(node.id);

  return (
    <ReactFlow<CodeFlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onInit={setInstance}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: 0.12, minZoom: 0.28, maxZoom: fitMaxZoom }}
      minZoom={0.18}
      maxZoom={1.65}
      proOptions={{ hideAttribution: true }}
    >
      <ViewportPortal>
        <div className="code-layer-regions" style={{ width: layout.width, height: layout.height }}>
          {layout.lanes.map((lane) => (
            <div key={lane.layer} className={`code-layer-region layer-${lane.layer}`} style={{ top: lane.y, width: layout.width, height: lane.height }}>
              <span>{lane.label}</span>
            </div>
          ))}
        </div>
      </ViewportPortal>
      <Background color="#d7dfe8" gap={24} size={1} />
      <MiniMap<CodeFlowNode> pannable zoomable nodeColor={(node) => RELATION_COLORS[node.data.relations[0] ?? "call"]} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
