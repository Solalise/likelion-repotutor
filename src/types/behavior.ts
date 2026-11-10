import type { CodeRelation, FunctionRelation, ReactEventBinding, ReactEventBindingReason, RepositoryEntryPoint } from "./analysis";
import type { ControlFlowGuard, ControlFlowReachability, FunctionControlFlow } from "./controlFlow";
import type { BehaviorHttpRequest } from "./http";
import type { BehaviorDatabaseAccess } from "./database";
import type { BehaviorServerResponses } from "./response";

export type BehaviorConfidence = "confirmed" | "inferred" | "unknown";
/** Reserved kinds are part of the vocabulary, not evidence that the extractor supports them. */
export type BehaviorNodeKind = "screen" | "event" | "function" | "api-request" | "server" | "data-access" | "condition" | "result" | "unknown";
export type BehaviorRelation = "call" | "reference" | "component" | "api-request" | "api-route" | "event-binding" | "event-handler" | "branch" | "return" | "data-access";
export type BehaviorLocation = { filePath: string } & (
  | { precision: "file"; startLine?: never; endLine?: never }
  | { precision: "line" | "range"; startLine: number; endLine: number; startOffset?: number; endOffset?: number; startColumn?: number; endColumn?: number }
);

export interface BehaviorEvidence {
  id: string;
  location: BehaviorLocation;
  /** Original source slice; never a generated explanation. Absent for file-only entry metadata. */
  excerpt?: string;
  confidence: BehaviorConfidence;
  sourceNodeIds: string[];
  sourceEdgeIds: string[];
  origin:
    | { kind: "declaration"; nodeId: string }
    | { kind: "entry-point"; entryPoint: RepositoryEntryPoint }
    | { kind: "relation"; sourceId: string; relation: FunctionRelation }
    | { kind: "event-binding"; binding: ReactEventBinding };
}

export interface BehaviorNode {
  id: string;
  kind: BehaviorNodeKind;
  label: string;
  confidence: BehaviorConfidence;
  sourceNodeIds: string[];
  sourceEdgeIds: string[];
  evidenceIds: string[];
  /** Only present for an API request site, not guessed from the function's name. */
  request?: { path: string; method: string };
  /** Refers to a verified JSX binding, not an observed user interaction. */
  eventBindingId?: string;
  /** Optional detail graph reference; outer behavior edges remain static code relations. */
  controlFlowId?: string;
}

export interface BehaviorEventFinding {
  bindingId: string;
  ownerNodeId: string;
  confidence: BehaviorConfidence;
  status: "projected" | "unresolved" | "excluded";
  reason?: ReactEventBindingReason | "evidence-unavailable" | "entry-boundary" | "traversal-limit";
  evidenceIds: string[];
  eventNodeId?: string;
}

export interface BehaviorEdge {
  id: string;
  source: string;
  target: string;
  relation: BehaviorRelation;
  confidence: BehaviorConfidence;
  semantics: "static-relation" | "control-flow" | "runtime-observed";
  executionOrder: "not-established" | "established";
  sourceEdgeIds: string[];
  evidenceIds: string[];
  callContexts?: BehaviorCallContext[];
}

export interface BehaviorCallContext {
  controlFlowId: string;
  callSiteId: string;
  statementId: string;
  graphNodeIds: string[];
  branchPath: ControlFlowGuard[];
  reachability: ControlFlowReachability;
  execution: "not-established";
}

export type BehaviorLimitationCode =
  | "execution-order-unavailable" | "event-semantics-unavailable" | "conditions-unavailable"
  | "data-access-unavailable" | "results-unavailable" | "entry-point-unavailable"
  | "evidence-unavailable" | "entry-boundary" | "partial-source" | "traversal-limit"
  | "invalid-analysis" | "unversioned-source";

export interface BehaviorLimitation {
  code: BehaviorLimitationCode;
  message: string;
  sourceNodeIds?: string[];
  sourceEdgeIds?: string[];
}

export interface BehaviorUnresolvedRelation {
  id: string;
  sourceNodeId: string;
  relation: CodeRelation;
  targetName?: string;
  confidence: BehaviorConfidence;
  reason: "unresolved-target" | "inferred-relation" | "evidence-unavailable" | "entry-boundary" | "traversal-limit";
  request?: { path?: string; method?: string };
  evidenceIds: string[];
  sourceEdgeIds: string[];
}

export interface BehaviorFlow {
  schemaVersion: 1;
  id: string;
  repository: string;
  commitSha?: string;
  entryPoint: RepositoryEntryPoint;
  entryNodeId?: string;
  status: "partial" | "unavailable";
  semantics: "static-code-relations";
  executionOrder: "not-established";
  nodes: BehaviorNode[];
  edges: BehaviorEdge[];
  evidence: BehaviorEvidence[];
  unresolved: BehaviorUnresolvedRelation[];
  eventBindings?: BehaviorEventFinding[];
  controlFlows?: FunctionControlFlow[];
  /** Position-based HTTP boundaries supplement, rather than replace, legacy graphs. */
  httpRequests?: BehaviorHttpRequest[];
  databaseAccesses?: BehaviorDatabaseAccess[];
  serverResponses?: BehaviorServerResponses;
  limitations: BehaviorLimitation[];
}

export interface BehaviorAnalysis {
  schemaVersion: 1;
  repository: string;
  flows: BehaviorFlow[];
  limitations: BehaviorLimitation[];
}

export interface BehaviorBuildOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
  /** Default true for analyses carrying event metadata; false retains the stage-1 projection. */
  includeEvents?: boolean;
  /** Defaults to true when CFG metadata exists; old cached analyses remain usable. */
  includeControlFlow?: boolean;
  /** Existing AST function IDs; omit to attach all projected function details. */
  expandFunctionIds?: string[];
}

export interface BehaviorValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; id?: string }>;
}
