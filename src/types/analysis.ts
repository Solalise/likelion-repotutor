export type CodeNodeType = "file" | "function" | "api" | "component";
export type CodeRelation = "import" | "call" | "component" | "reference" | "api";

export interface CodeNode {
  id: string;
  type: CodeNodeType;
  name: string;
  filePath: string;
  line?: number;
  endLine?: number;
  sourceCode?: string;
}

export interface CodeEdge {
  id: string;
  source: string;
  target: string;
  relation: CodeRelation;
}

export interface ImportInfo {
  source: string;
  symbols: string[];
  line: number;
}

export interface FunctionInfo {
  id: string;
  name: string;
  filePath: string;
  line: number;
  kind: "function" | "arrow" | "method";
  nodeType: "function" | "component" | "api";
  calls: string[];
  componentReferences: string[];
  callbackReferences: string[];
  sourceCode: string;
  endLine: number;
  parentId?: string;
}

export interface FileAnalysis {
  path: string;
  name: string;
  sourceCode: string;
  imports: ImportInfo[];
  functions: FunctionInfo[];
}

export interface AnalysisStats {
  files: number;
  functions: number;
  relations: number;
}

export type AnalysisSource = "sample" | "github";

export interface RepositoryCollection {
  source: AnalysisSource;
  repositoryUrl?: string;
  defaultBranch?: string;
  commitSha?: string;
  discoveredFiles: number;
  collectedFiles: number;
  totalBytes: number;
  durationMs: number;
  partial: boolean;
  treeTruncated?: boolean;
  archiveBytes?: number;
  cached?: boolean;
  apiRequestCount?: number;
  notice?: string;
}

export interface RepositoryAnalysis {
  repository: string;
  files: FileAnalysis[];
  nodes: CodeNode[];
  edges: CodeEdge[];
  stats: AnalysisStats;
  source?: AnalysisSource;
  collection?: RepositoryCollection;
}

export interface SourceInput {
  path: string;
  content: string;
}

export interface TraversalResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

export interface RepositoryFeature {
  id: string;
  title: string;
  technicalName: string;
  description: string;
  entryNodeId: string;
  entryFilePath: string;
  nodeIds: string[];
  filePaths: string[];
  connectedNodeCount: number;
  connectionCount: number;
  limited: boolean;
  hidden: boolean;
  hiddenReason?: string;
  score: number;
}

export interface RepositoryFeatureDiscovery {
  primary: RepositoryFeature[];
  limited: RepositoryFeature[];
  hidden: RepositoryFeature[];
}
