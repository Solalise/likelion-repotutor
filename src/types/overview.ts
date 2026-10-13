import type { CodeRelation } from "@/types/analysis";

export type OverviewNodeType = "project" | "module" | "file" | "symbol";
export type OverviewRelation = "contains" | CodeRelation;

export interface RepositoryOverviewNode {
  id: string;
  type: OverviewNodeType;
  name: string;
  subtitle: string;
  filePath?: string;
  codeNodeId?: string;
  fileCount?: number;
  symbolCount?: number;
  expandable: boolean;
  expanded: boolean;
}

export interface RepositoryOverviewEdge {
  id: string;
  source: string;
  target: string;
  relation: OverviewRelation;
  count: number;
}

export interface RepositoryOverviewGraph {
  nodes: RepositoryOverviewNode[];
  edges: RepositoryOverviewEdge[];
  truncated: boolean;
  hiddenNodeCount: number;
}
