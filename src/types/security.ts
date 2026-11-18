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
