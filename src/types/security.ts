export interface SqlInjectionEvidence {
  filePath: string;
  line: number;
  code: string;
  description: string;
}

export interface SqlInjectionFinding {
  id: string;
  type: "SQL_INJECTION";
  severity: "HIGH" | "MEDIUM" | "LOW";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  relationship: "input-flow-observed" | "suspected";
  filePath: string;
  line: number;
  endLine: number;
  sink: string;
  clientLibrary?: string;
  code: string;
  evidence: SqlInjectionEvidence[];
  reason: string;
  remediation: string;
  limitations: string[];
  runtimeExploitation: "not-tested";
}

export interface SqlInjectionAnalysis {
  version: "sqli-static-v1";
  findings: SqlInjectionFinding[];
  truncated: boolean;
  limitations: string[];
}

export interface XssFinding extends Omit<SqlInjectionFinding, "type" | "clientLibrary"> {
  type: "XSS";
  environment: "client" | "server" | "unknown";
  sinkKind: "dom-html" | "react-html" | "server-html";
  disposition: "candidate" | "protected";
  protection: "unverified" | "sanitized" | "escaped";
  inputSources: SqlInjectionEvidence[];
}

export interface XssAnalysis {
  version: "xss-static-v1";
  findings: XssFinding[];
  truncated: boolean;
  limitations: string[];
}

export interface AccessCheckEvidence extends SqlInjectionEvidence {
  kind: "authentication" | "ownership" | "role" | "middleware" | "external-check";
  relation: "confirmed" | "inferred";
  control: "guard-before-operation" | "query-filter" | "after-operation" | "conditional-or-unused" | "unresolved";
  functionId?: string;
}
export interface AccessControlFinding extends Omit<SqlInjectionFinding, "type"> {
  type: "IDOR" | "AUTHORIZATION";
  ownerFunctionId: string;
  functionName: string;
  api: { path: string; method: string; filePath: string; relation: "confirmed" } | null;
  operationRelation: "confirmed" | "inferred";
  reviewState: "CHECKS_OBSERVED" | "UNCONFIRMED";
  inputSources: SqlInjectionEvidence[];
  checks: AccessCheckEvidence[];
  callPath: SqlInjectionEvidence[];
  manualChecks: string[];
  assessment: "STATIC_REVIEW_ONLY";
}
export interface AccessControlAnalysis {
  version: "access-control-static-v1";
  status: "completed" | "partial" | "failed";
  findings: AccessControlFinding[];
  boundaries: SqlInjectionEvidence[];
  truncated: boolean;
  limitations: string[];
}
