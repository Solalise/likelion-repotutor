/** Source-backed, function-BODY-only CFG; not a runtime trace or a call graph. */
export interface ControlFlowLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface ControlFlowGuard { conditionStatementId: string; branch: "true" | "false" }
export type ControlFlowCompletion = "normal" | "return" | "throw" | "unknown";
export type ControlFlowReachability = "reachable-in-model" | "unreachable-in-model" | "unknown";

export interface ControlFlowStatement {
  id: string;
  ownerFunctionId: string;
  kind: "expression" | "variable" | "if" | "return" | "throw" | "try" | "catch" | "finally" | "block" | "declaration" | "empty" | "unsupported";
  syntaxKind: string;
  location: ControlFlowLocation;
  sourceCode: string;
  depth: number;
  parentStatementId?: string;
  branchPath: ControlFlowGuard[];
  condition?: { sourceCode: string; location: ControlFlowLocation };
  implicitReturn?: boolean;
  children?: string[];
  thenBranch?: string[];
  elseBranch?: string[];
  tryBlockId?: string;
  catchClauseId?: string;
  finallyClauseId?: string;
  callSiteIds: string[];
  awaitSiteIds: string[];
  /** A possible exceptional completion, not proof of an exception occurring. */
  mayThrow: boolean;
  unsupportedReason?: string;
  reachability: ControlFlowReachability;
}

export interface ControlFlowCallSite {
  id: string;
  ownerFunctionId: string;
  statementId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  targetNodeId?: string;
  targetResolution: "resolved" | "unresolved";
  /** Existing call CodeEdge IDs only; never invented to compensate for old merging. */
  sourceEdgeIds: string[];
  branchPath: ControlFlowGuard[];
  inUnsupportedRegion: boolean;
  execution: "not-established";
}

export interface ControlFlowAwaitSite {
  id: string;
  ownerFunctionId: string;
  statementId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  branchPath: ControlFlowGuard[];
  inUnsupportedRegion: boolean;
  completionOrder: "not-established";
}

export interface ControlFlowContext { tryStatementId: string; pendingCompletion: Exclude<ControlFlowCompletion, "unknown"> }
export interface ControlFlowNode {
  id: string;
  ownerFunctionId: string;
  kind: "entry" | "normal-exit" | "return-exit" | "throw-exit" | "analysis-boundary" | "statement";
  statementId?: string;
  /** Finally clones keep different pending completion states from mixing. */
  context: ControlFlowContext[];
  reachability: ControlFlowReachability;
}

export interface ControlFlowEdge {
  id: string;
  source: string;
  target: string;
  kind: "next" | "true" | "false" | "return" | "throw" | "exception" | "finally" | "resume" | "unknown";
  completion: ControlFlowCompletion;
  certainty: "structural" | "possible";
  semantics: "static-control-flow";
  reason?: "expression-may-throw" | "unsupported-region";
}

export interface ControlFlowLimitation { code: string; message: string; statementIds?: string[] }

export interface FunctionControlFlow {
  schemaVersion: 1;
  id: string;
  ownerFunctionId: string;
  functionLocation: ControlFlowLocation;
  scope: "function-body";
  semantics: "intra-function-static-control-flow";
  runtimeExecution: "not-observed";
  status: "supported" | "partial" | "unavailable";
  bodyStatementIds: string[];
  entryNodeId: string;
  exits: { normal: string; return: string; throw: string; unknown: string };
  statements: ControlFlowStatement[];
  callSites: ControlFlowCallSite[];
  awaitSites: ControlFlowAwaitSite[];
  nodes: ControlFlowNode[];
  edges: ControlFlowEdge[];
  limitations: ControlFlowLimitation[];
}
