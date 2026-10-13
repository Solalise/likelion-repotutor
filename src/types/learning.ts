export type LearningCategory =
  | "start"
  | "ui-action"
  | "service"
  | "logic"
  | "api"
  | "database"
  | "condition"
  | "error"
  | "end";

export type LearningRelation = "execute" | "call" | "component" | "reference" | "import" | "request" | "query" | "return" | "branch";

export interface LearningNode {
  id: string;
  technicalName?: string;
  title: string;
  description: string;
  purpose: string;
  category: LearningCategory;
  filePath?: string;
  line?: number;
  codeSnippet?: string;
  codeEndLine?: number;
  nextStep?: string;
  relatedFiles: string[];
  connectionReason: string;
  incomingRelations: string[];
  outgoingRelations: string[];
  confidence: "confirmed" | "limited";
  source: "ast" | "demo";
}

export type LearningStageKind = "overview" | "ui" | "action" | "data" | "result";

export interface LearningStage {
  id: string;
  kind: LearningStageKind;
  title: string;
  description: string;
  nodeIds: string[];
}

export interface LearningEdge {
  id: string;
  source: string;
  target: string;
  relation: LearningRelation;
  label?: string;
}

export interface LearningGraph {
  nodes: LearningNode[];
  edges: LearningEdge[];
}
