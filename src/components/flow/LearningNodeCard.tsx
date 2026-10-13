"use client";

import { AlertTriangle, CheckCircle2, Code2, Database, Diamond, Flag, MousePointerClick, Radio, Wrench } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LearningCategory, LearningNode } from "@/types/learning";

export type LearningFlowNode = Node<{ learning: LearningNode }, "learning">;

const ICONS: Record<LearningCategory, typeof Flag> = {
  start: Flag,
  "ui-action": MousePointerClick,
  service: Wrench,
  logic: Code2,
  api: Radio,
  database: Database,
  condition: Diamond,
  error: AlertTriangle,
  end: CheckCircle2,
};

const CATEGORY_LABELS: Record<LearningCategory, string> = {
  start: "시작",
  "ui-action": "화면 동작",
  service: "서비스",
  logic: "로직",
  api: "API",
  database: "데이터 조회",
  condition: "조건",
  error: "오류",
  end: "완료",
};

export function LearningNodeCard({ data, selected }: NodeProps<LearningFlowNode>) {
  const node = data.learning;
  const Icon = ICONS[node.category];
  return (
    <div className={`learning-node-card ${node.category} ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="learning-handle" />
      <div className="learning-node-topline">
        <span className="learning-node-icon"><Icon size={15} /></span>
        <span className="learning-category">{CATEGORY_LABELS[node.category]}</span>
        {node.source === "demo" && <span className="demo-mark">DEMO</span>}
      </div>
      <strong>{node.title}</strong>
      {node.technicalName && <code>{node.technicalName}()</code>}
      {node.filePath && <small>{node.filePath}</small>}
      <Handle type="source" position={Position.Bottom} className="learning-handle" />
    </div>
  );
}
