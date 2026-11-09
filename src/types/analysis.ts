export type CodeNodeType = "file" | "function" | "api" | "component";
export type CodeRelation = "import" | "call" | "component" | "reference" | "api";
export type RelationConfidence = "confirmed" | "inferred";

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
  line?: number;
  evidence?: string;
  confidence?: RelationConfidence;
  occurrences?: CodeEdgeOccurrence[];
}

export interface CodeEdgeOccurrence {
  edgeId: string;
  line?: number;
  evidence?: string;
  confidence?: RelationConfidence;
}

export interface FunctionRelation {
  relation: Exclude<CodeRelation, "import">;
  name: string;
  targetId?: string;
  line: number;
  evidence: string;
  confidence: RelationConfidence;
  requestPath?: string;
  requestMethod?: string;
}

export interface ImportInfo {
  source: string;
  symbols: string[];
  bindings?: Array<{ local: string; imported: string }>;
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
  relations?: FunctionRelation[];
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
  unresolvedRelations?: number;
  unmatchedApiRequests?: number;
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
  indexedFiles?: number;
  dependencyFiles?: number;
  skippedByFileLimit?: number;
  skippedByByteLimit?: number;
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
  entryPoints?: RepositoryEntryPoint[];
}

/** File-route exports resolved to existing AST function IDs on the server. */
export interface RepositoryEntryPoint {
  kind: "page" | "api";
  framework: "next-app" | "app-index";
  filePath: string;
  routePath: string;
  method?: string;
  nodeId: string;
}

export interface SourceInput {
  path: string;
  content: string;
}

export interface TraversalResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
  deferredNodeIds?: string[];
  /** Within-Depth omissions only; edges are counted as display relation groups. */
  hiddenNodeCount?: number;
  hiddenEdgeCount?: number;
  /** Reachable before component folding and display limits, within the requested Depth. */
  reachableNodeCount?: number;
  reachableEdgeCount?: number;
  /** Depth exclusions are separate from hidden-by-display counts. */
  depthLimitedNodeCount?: number;
  depthLimitedEdgeCount?: number;
  collapsedNodeCount?: number;
  nodeLimitHiddenNodeCount?: number;
  edgeLimitHiddenNodeCount?: number;
  traversalStates?: Record<string, "New" | "Tracing" | "Used">;
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
  entryKind?: "page" | "api" | "manual" | "internal";
  routePath?: string;
  httpMethod?: string;
  titleInferred?: boolean;
  edgeIds?: string[];
}

export interface RepositoryFeatureDiscovery {
  primary: RepositoryFeature[];
  limited: RepositoryFeature[];
  hidden: RepositoryFeature[];
}
