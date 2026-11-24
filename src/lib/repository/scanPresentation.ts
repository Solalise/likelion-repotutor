import type { RepositoryAnalysis } from "@/types/analysis";
import type { ScanStatus } from "@/types/scanCoverage";

export function scanPresentation(analysis: RepositoryAnalysis, kind: "SQL_INJECTION" | "XSS" | "IDOR" | "AUTHORIZATION") {
  const access = kind === "IDOR" || kind === "AUTHORIZATION";
  const report = access ? analysis.accessControl : kind === "XSS" ? analysis.xss : analysis.sqlInjection;
  const findings = report?.findings.filter(f => f.type === kind && !(f.type === "XSS" && f.disposition === "protected")) ?? [];
  let status: ScanStatus = !report ? "unsupported" : access ? analysis.accessControl!.status :
    (kind === "XSS" ? analysis.xss : analysis.sqlInjection)?.coverage?.status ?? "partial";
  if (status === "completed" && (analysis.collection?.partial || analysis.diagnostics?.length || report?.truncated)) status = "partial";
  if (kind === "SQL_INJECTION" && status !== "failed" && analysis.technology?.databases.includes("MongoDB") && !analysis.sqlInjection?.coverage?.sinks.length) status = "unsupported";
  if (access && report && status !== "failed" && !analysis.entryPoints?.some(e => e.kind === "api" && e.framework === "next-app") && !analysis.serverActions?.length && !findings.length) status = "unsupported";
  return { status, candidates: findings.length };
}
