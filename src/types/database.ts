import type { RepositoryEntryPoint } from "./analysis";
import type { ControlFlowLocation } from "./controlFlow";
import type { HttpRequestContext } from "./http";

export type DatabaseOperationType = "read" | "write" | "transaction" | "unknown";
export interface DatabaseEvidence {
  kind: "constructor-import" | "client-construction" | "alias" | "factory-return" | "argument-binding" | "transaction-callback";
  location: ControlFlowLocation;
  sourceCode: string;
}
export interface DatabaseCallStep {
  kind: "call" | "transaction-callback";
  sourceFunctionId: string;
  targetFunctionId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  sourceEdgeIds: string[];
  context?: HttpRequestContext;
  transactionSiteId?: string;
}
export interface DatabaseServerContext {
  id: string;
  entryPoint: RepositoryEntryPoint;
  callPath: DatabaseCallStep[];
  status: "confirmed" | "unresolved";
  reason?: string;
  clientEvidence: DatabaseEvidence[];
  transactionSiteId?: string;
}
/** Candidate access syntax. Only confirmed server contexts identify a Prisma operation. */
export interface DatabaseAccessSite {
  id: string;
  ownerFunctionId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  clientExpression: string;
  model?: string;
  operation?: string;
  operationExpression: string;
  operationType: DatabaseOperationType;
  /** Aggregated status: at least one server context is proven; inspect each context separately. */
  status: "confirmed" | "unresolved";
  reason?: string;
  contextStatus: "mapped" | "unsupported-region" | "not-available";
  context?: HttpRequestContext;
  serverContexts: DatabaseServerContext[];
}
export interface DatabaseAnalysis {
  sites: DatabaseAccessSite[];
  limitations: Array<{ code: string; message: string; entryPoint?: RepositoryEntryPoint }>;
}
export interface BehaviorDatabaseAccess {
  site: Omit<DatabaseAccessSite, "serverContexts">;
  serverContext: DatabaseServerContext;
  ownerBehaviorNodeId?: string;
  semantics: "static-database-access";
  runtimeExecution: "not-observed";
  queryResult: "not-analyzed";
  transactionCommit: "not-established";
}
