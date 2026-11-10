/** Browser-safe query contract. IDs are snapshot + feature scoped; never authorization tokens. */
export type BehaviorView="features"|"flow"|"node"|"expand"|"cfg";
export interface BehaviorFeaturesResponse {snapshot:BehaviorSnapshot;status:"indexed"|"unsupported";features:QueryFeature[];countsNotice:string}
export interface BehaviorSnapshot {analysisId:string;repository:string;commitSha:string|null;version:string;source:"connected"|"github"|"sample";sourcePartial:boolean}
export interface QueryCounts {nodes:number;edges:number}
export interface QueryTruncation {
 analysis:boolean;reasons:string[];omittedByAnalysis:"unknown"|"none";recoverableByExpansion:false;
 projection:boolean;knownHiddenNodes:number;knownHiddenEdges:number;
 projectionReason?:"page-limit"|"viewport-limit";
 analysisRecoverableByExpansion:false;
 viewportCanExpand:boolean;
}
export interface QueryFeature {
 id:string;sourceFeatureId:string;name:string;entryPoint:{kind:"page"|"api";routePath:string;method?:string;filePath:string};
 status:"indexed"|"partial"|"unavailable";flowStatus:"not-generated"|"cached";
 sourceScopeCounts:QueryCounts;flowCounts:QueryCounts|null;
 coreFlowCounts:QueryCounts|null;
 presence:{events:boolean;http:boolean;database:boolean;responses:boolean};
 unresolved:{count:number;basis:"source-scope"|"flow-facts"};
 truncation:{assessment:"not-generated"|"assessed";analysis:boolean|null;reasons:string[]};
}
export interface QueryNode {
 id:string;kind:string;label:string;confidence:string;boundary:boolean;
 facts:{http:number;database:number;responses:number};cfgAvailable:boolean;
 expandable:boolean;remainingNeighbors:number;
 origin:"behavior"|"metadata";
 cfgSummary:{conditions:number;unsupported:number;returns:number};
 reason?:string;
 targetFeatureIds?:string[];
}
export interface QueryEdge {id:string;source:string;target:string;relation:string;semantics:string;confidence:string;executionOrder:"not-established";conditional:boolean}
export interface BehaviorGraphResponse {
 snapshot:BehaviorSnapshot;featureId:string;status:"partial"|"unavailable";
 rootId:string;nodes:QueryNode[];edges:QueryEdge[];visibleNodeIds:string[];available:QueryCounts;
 coreFlowCounts:QueryCounts;
 truncation:QueryTruncation;unresolved:Record<string,number>;unsupportedRegions:number;
 metadata:{http:number;database:number;responses:number};limits:{initial:number;maxPage:number;maxVisible:number};
}
export interface CodeChunk {
 filePath:string;startLine:number;endLine:number;startColumn:number;endColumn:number;startOffset:number;endOffset:number;
 text:string;offset:number;nextOffset:number|null;totalChars:number;
}
export interface BehaviorNodeDetail {
 snapshot:BehaviorSnapshot;featureId:string;node:QueryNode;code:CodeChunk|null;
 sourceCodeNodeIds:string[];sourceFeatureId:string;
 evidence:{items:Array<{index:number;kind:string;filePath:string;startLine?:number;endLine?:number;excerpt?:string}>;total:number;nextOffset:number|null};
 facts:{items:Array<Record<string,unknown>>;total:number;nextOffset:number|null};
 cfg:{available:boolean;reason?:string;statementCount:number;nodeCount:number};
 calls:{items:Array<Record<string,unknown>>;total:number;nextOffset:number|null};
 bindings:{items:Array<Record<string,unknown>>;total:number;nextOffset:number|null};
 reasons:string[];
}
export interface BehaviorCfgResponse {
 snapshot:BehaviorSnapshot;featureId:string;nodeId:string;semantics:"intra-function-static-control-flow";runtimeExecution:"not-observed";
 status:string;nodes:Array<{id:string;kind:string;statementId?:string;reachability:string;context:unknown}>;
 edges:Array<{id:string;source:string;target:string;kind:string;completion:string;certainty:string}>;
 statements:Array<{id:string;kind:string;location:unknown;depth:number;condition?:string;branchPath:unknown;unsupportedReason?:string}>;
 total:QueryCounts;offset:number;nextOffset:number|null;hiddenEdges:number;limitations:Array<{code:string;message:string}>;
}
export interface BehaviorQueryError {error:{code:string;message:string;retryable:boolean};status:"unavailable"|"in-progress"|"stale"}
