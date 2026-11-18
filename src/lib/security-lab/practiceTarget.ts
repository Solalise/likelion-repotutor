import type { RepositoryAnalysis } from "@/types/analysis";
import type { SqlInjectionFinding, XssFinding } from "@/types/security";

export const practiceMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type PracticeFinding = SqlInjectionFinding | XssFinding;

/** Only a finding inside the resolved handler itself qualifies. Call edges do not prove input flow. */
export function practiceTarget(analysis: RepositoryAnalysis, finding: PracticeFinding) {
  const owners = analysis.files.flatMap(file => file.functions).filter(fn =>
    fn.filePath === finding.filePath && fn.line <= finding.line && fn.endLine >= finding.endLine);
  const innermost = owners.filter(fn => !owners.some(other => other.id !== fn.id
    && other.line >= fn.line && other.endLine <= fn.endLine
    && (other.line > fn.line || other.endLine < fn.endLine)));
  const entries = innermost.length === 1 ? (analysis.entryPoints ?? []).filter(entry =>
    entry.kind === "api" && entry.framework === "next-app" && entry.nodeId === innermost[0].id
    && practiceMethods.includes(entry.method as typeof practiceMethods[number])) : [];
  const unique = entries.filter((entry, index) => entries.findIndex(other =>
    other.routePath === entry.routePath && other.method === entry.method && other.filePath === entry.filePath) === index);
  const entry = unique.length === 1 ? unique[0] : undefined;
  return {
    path: entry?.routePath ?? "", method: entry?.method ?? "",
    status: entry ? "STATIC_HANDLER" as const : "MANUAL_REQUIRED" as const,
    reason: entry ? "AST에서 후보를 포함하는 Route Handler와 export 메서드를 확인했습니다. 배포 경로·rewrite·basePath는 직접 확인하세요."
      : "API 연결 미확정: Pages API, 클라이언트 XSS, 별도 함수 또는 여러 진입점은 경로와 메서드를 직접 확인하세요.",
  };
}

/** Display-only validation. Never fetches a target or grants execution approval. */
export function targetUrl(base: string | null | undefined, path: string): string | null {
  if (!base || !path.startsWith("/") || path.startsWith("//") || /[\\\s\u0000-\u001f\u007f?#\[\]]/.test(path)) return null;
  try {
    const decoded = decodeURIComponent(path);
    if (/[\\\s\u0000-\u001f\u007f?#\[\]]/.test(decoded) || decoded.startsWith("//")
      || decoded.split("/").some(part => part === "." || part === "..")) return null;
    const origin = new URL(base);
    const url = new URL(path, origin);
    if (origin.protocol !== "https:" || origin.username || origin.password || url.origin !== origin.origin) return null;
    return url.href;
  } catch { return null; }
}
