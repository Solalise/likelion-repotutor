import type { RepositoryEntryPoint } from "./analysis";
import type { ControlFlowLocation } from "./controlFlow";
import type { HttpRequestContext, HttpValueEvidence } from "./http";

export type ResponseContext = Omit<HttpRequestContext, "callSiteId"> & { callSiteId?: string };
export interface ResponseDataSource {
  id: string;
  fieldPath: string[];
  expression: HttpValueEvidence;
  kind: "database-result" | "literal" | "unknown";
  status: "confirmed" | "unresolved";
  reason?: string;
  databaseSiteId?: string;
  sourcePropertyPath?: string[];
  evidence: HttpValueEvidence[];
}
export interface ResponseCreation {
  id: string;
  ownerFunctionId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  pattern: "next-json" | "response-json" | "response-constructor";
  constructorResolution: "confirmed" | "unresolved";
  constructorEvidence: HttpValueEvidence[];
  statusCode?: number;
  statusResolution: "static" | "default" | "unresolved";
  statusEvidence: HttpValueEvidence[];
  context?: ResponseContext;
  dataSources: ResponseDataSource[];
}
export interface ResponseReturn {
  id: string;
  ownerFunctionId: string;
  location: ControlFlowLocation;
  sourceCode: string;
  implicit: boolean;
  context?: ResponseContext;
  responseSiteId?: string;
  resolution: "confirmed" | "unresolved";
  reason?: string;
  evidence: HttpValueEvidence[];
}
/** Reuses CFG call-site IDs instead of duplicating function bodies/call paths. */
export interface ResponseServerContext {
  id: string;
  ownerFunctionId: string;
  entryPoint: RepositoryEntryPoint;
  callSiteIds: string[];
}
export interface ServerResponseAnalysis {
  creations: ResponseCreation[];
  returns: ResponseReturn[];
  serverContexts: ResponseServerContext[];
  limitations: Array<{code:string; message:string}>;
}
export interface BehaviorServerResponses {
  semantics: "static-response-references";
  runtimeDelivery: "not-established";
  creations: Array<{siteId:string; serverContextId:string; returnedBy:string[]}>;
  returns: Array<{
    returnSiteId:string;
    serverContextId:string;
    kind:"entry-return-reference" | "helper-local-return" | "unresolved-return";
    responseSiteId?:string;
    dataSources:Array<{sourceId:string; status:"confirmed"|"unresolved"; reason?:string; databaseContextId?:string}>;
  }>;
}
