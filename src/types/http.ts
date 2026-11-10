import type { RepositoryEntryPoint } from "./analysis";
import type { ControlFlowLocation, ControlFlowGuard, ControlFlowReachability } from "./controlFlow";

export interface HttpValueEvidence { location: ControlFlowLocation; sourceCode: string }
export interface HttpRequestContext {
  controlFlowId: string;
  callSiteId: string;
  statementId: string;
  graphNodeIds: string[];
  branchPath: ControlFlowGuard[];
  reachability: ControlFlowReachability;
  inUnsupportedRegion: boolean;
  execution: "not-established";
}
/** A source location, not evidence that a request was sent or completed. */
export interface HttpRequestSite {
  id: string;
  ownerFunctionId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  transport: "fetch";
  urlExpression?: string;
  methodExpression?: string;
  url?: string;
  path?: string;
  method?: string;
  valueEvidence: HttpValueEvidence[];
  status: "matched" | "unresolved";
  reason?: string;
  candidates: Array<{ filePath: string; routePath: string; methods: string[] }>;
  target?: {
    entryPoint: RepositoryEntryPoint;
    matchKind: "static" | "dynamic" | "catch-all" | "optional-catch-all";
    parameters: Record<string, string | string[]>;
  };
  contextStatus: "mapped" | "unsupported-region" | "not-available";
  context?: HttpRequestContext;
}

/** Separate HTTP relation layer: never an intra-process call or CFG edge. */
export interface BehaviorHttpRequest {
  request: HttpRequestSite;
  ownerBehaviorNodeId: string;
  boundary?: {
    id: string;
    relation: "http-request-to-entry";
    semantics: "http-boundary";
    confidence: "confirmed";
    requestSiteId: string;
    serverEntryPoint: RepositoryEntryPoint;
    serverFlowId: string;
    serverControlFlowId?: string;
    runtimeTransfer: "not-observed";
    executionOrder: "not-established";
    response: "not-analyzed";
    exceptionPropagation: "not-modeled";
  };
}
