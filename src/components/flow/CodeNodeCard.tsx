"use client";

import { Braces, Component, Database, FileCode2, Globe2, MousePointerClick, ServerCog } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CodeLayer } from "@/lib/graph/codeFlowLayout";
import type { CodeNode, CodeRelation } from "@/types/analysis";

export interface CodeNodeCardData extends Record<string, unknown> {
  codeNode: CodeNode;
  layer: CodeLayer;
  role: string;
  relations: CodeRelation[];
}

export type CodeFlowNode = Node<CodeNodeCardData, "code">;

const ICONS = {
  ui: Component,
  event: MousePointerClick,
  "api-client": Globe2,
  "api-route": ServerCog,
  service: Braces,
  data: Database,
  logic: Braces,
  file: FileCode2,
} satisfies Record<CodeLayer, typeof Braces>;

const RELATION_LABELS: Record<CodeRelation, string> = {
  call: "call",
  reference: "event/ref",
  component: "component",
  api: "API",
  import: "import",
};

export function CodeNodeCard({ data, selected }: NodeProps<CodeFlowNode>) {
  const Icon = ICONS[data.layer];
  const { codeNode } = data;
  return (
    <div className={`code-node-card layer-${data.layer}${selected ? " is-selected" : ""}`}>
      <Handle className="code-handle" type="target" position={Position.Left} />
      <div className="code-node-heading">
        <span className="code-node-icon"><Icon size={15} /></span>
        <span className="code-node-role">{data.role}</span>
        {codeNode.line && <small>L{codeNode.line}</small>}
      </div>
      <strong title={codeNode.name}>{codeNode.name}{codeNode.type !== "file" && "()"}</strong>
      <code title={codeNode.filePath}>{codeNode.filePath}</code>
      <div className="code-node-relations" aria-label="연결 관계 유형">
        {data.relations.map((relation) => <span key={relation} className={`relation-${relation}`}>{RELATION_LABELS[relation]}</span>)}
      </div>
      <Handle className="code-handle" type="source" position={Position.Right} />
    </div>
  );
}
