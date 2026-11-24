import type { FunctionInfo, RepositoryAnalysis } from "@/types/analysis";
import { containsCredentialMaterial } from "./manualAccess";

export type ReviewFactRole = "input" | "form" | "server-action" | "database" | "output" | "authentication" | "ownership" | "role" | "sql";
export type ReviewFact = { id: string; ownerId: string; role: ReviewFactRole; location: string; code: string; reason: string };
export type ReviewFeature = { id: string; label: string; facts: ReviewFact[]; relations: { from: string; to: string; status: "confirmed" | "unresolved"; description: string }[]; limitations: string[] };
const patterns: [ReviewFactRole, RegExp, string][] = [
  ["form", /<form\b|useActionState\s*\(/, "입력 폼 또는 액션 상태 연결 구문"],
  ["input", /<input\b|<textarea\b|<select\b|\bFormData\b|\b(?:formData|form|data)\.get\s*\(|request\.(?:json|formData)\s*\(/, "입력 요소 또는 입력값 수집 구문"],
  ["database", /\b\w+(?:\.\w+)*\.(?:create|insertOne|insertMany|find|findOne|findById|findMany|findUnique|findByIdAndUpdate|findByIdAndDelete|updateOne|updateMany|deleteOne|deleteMany|update|delete)\s*\(/, "데이터 처리 호출 구문. 클라이언트 종류·실행 결과는 별도 확인 필요"],
  ["sql", /\.(?:query|execute|\$queryRaw|\$executeRaw)\s*\(|\b(?:SELECT|INSERT INTO|UPDATE)\b/, "SQL 처리 관련 구문"],
  ["output", /dangerouslySetInnerHTML|\.innerHTML\s*=|\.textContent\s*=|\{[\w$]+(?:\??\.[\w$]+)+\}|\{[\w$]+\}/, "값 출력 구문. 실제 브라우저 실행 여부는 미확인"],
  ["authentication", /\b(?:auth|getServerSession|getSession|requireUserId|requireAuth)\s*\(/, "인증 정보 확인 호출. 작업 권한 확인과는 다름"],
  ["ownership", /(?:ownerId|tenantId|userId)\s*:|\.(?:ownerId|tenantId|userId)\s*[!=]==?/, "소유자·사용자 식별자 구문. 저장 필드인지 접근 제한 조건인지 별도 확인 필요"],
  ["role", /(?:if\s*\([^\n]*(?:role|isAdmin)|\.role\s*[!=]==?|roles?\.includes\s*\(|requireRole\s*\()/, "역할 조건 또는 역할 검사 호출. 거부 동작·검사 순서는 별도 확인 필요"],
];
function normalized(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part); }
  return parts.join("/").replace(/\.(?:[cm]?[jt]sx?)$/i, "").replace(/\/index$/, "");
}
export function collectReviewFeatures(analysis: RepositoryAnalysis): ReviewFeature[] {
  const functions = analysis.files.flatMap(file => file.functions);
  const byId = new Map(functions.map(fn => [fn.id, fn]));
  const links = analysis.edges.filter(e => ["call", "component", "reference", "api"].includes(e.relation) && byId.has(e.source) && byId.has(e.target))
    .map(e => ({ from: e.source, to: e.target, status: e.confidence === "confirmed" ? "confirmed" as const : "unresolved" as const,
      description: e.relation === "reference" ? "식별자 참조 관계이며 실행·입력값 전달은 미확인" : `${e.relation} 정적 관계. 실행·저장 후 재조회 흐름은 미확인` }));
  // Reuse AST import/function facts to resolve JSX action references missed by call edges.
  // Only an exact, unique imported function in an existing file can extend a feature.
  for (const file of analysis.files) for (const item of file.imports) {
    if (!item.source.startsWith(".") && !item.source.startsWith("@/")) continue;
    const path = item.source.startsWith("@/") ? item.source.slice(2) : normalized(`${file.path.split("/").slice(0, -1).join("/")}/${item.source}`);
    const targets = functions.filter(fn => normalized(fn.filePath) === normalized(path) || item.source.startsWith("@/") && normalized(fn.filePath) === `src/${normalized(path)}`);
    for (const binding of item.bindings ?? item.symbols.map(name => ({ local: name, imported: name }))) {
      const candidates = targets.filter(fn => fn.name === binding.imported);
      if (candidates.length !== 1 || !/^[\w$]+$/.test(binding.local)) continue;
      for (const owner of file.functions) {
        if (!new RegExp(`\\b${binding.local.replace(/\$/g, "\\$")}\\b\\s*(?:\\(|[,}])`).test(owner.sourceCode)) continue;
        if (!links.some(l => l.from === owner.id && l.to === candidates[0].id)) links.push({ from: owner.id, to: candidates[0].id, status: "confirmed", description: "AST import의 함수와 코드 참조가 일치함. 액션 실행 시점·데이터 전달은 미확인" });
      }
    }
  }
  const facts = new Map<string, ReviewFact[]>();
  for (const fn of functions) {
    const file = analysis.files.find(file => file.path === fn.filePath);
    const start = file?.sourceCode.indexOf(fn.sourceCode) ?? -1;
    const firstLine = start >= 0 ? file!.sourceCode.slice(0, start).split("\n").length : fn.line;
    const result: ReviewFact[] = [];
    for (const [offset, line] of fn.sourceCode.split("\n").entries()) {
      for (const [role, pattern, reason] of patterns) {
        if (!pattern.test(line) || role === "output" && !/\.[\w$]+\}|innerHTML|textContent|<[^>]+>\s*\{/.test(line)) continue;
        const code = line.trim().slice(0, 600), location = `${fn.filePath}:${firstLine + offset}`;
        if (containsCredentialMaterial(code) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(code)) continue;
        result.push({ id: `${fn.id}:${role}:${offset}`, ownerId: fn.id, role, location, code, reason });
      }
    }
    if (analysis.serverActions?.some(a => a.filePath === fn.filePath && a.name === fn.name)) {
      const declaration = fn.sourceCode.split("\n").findIndex(line => /(?:function\b|=>)/.test(line));
      if (declaration >= 0) result.push({ id: `${fn.id}:action`, ownerId: fn.id, role: "server-action", location: `${fn.filePath}:${firstLine + declaration}`, code: fn.sourceCode.split("\n")[declaration].trim(), reason: "기존 AST가 확인한 Server Action 함수 선언" });
    }
    facts.set(fn.id, result);
  }
  const roots: { fn: FunctionInfo; label: string }[] = [];
  for (const entry of analysis.entryPoints ?? []) { const fn = byId.get(entry.nodeId); if (fn) {
    const caption = fn.sourceCode.match(/>\s*(문의 게시판|문의하기|문의 목록|게시글 목록|관리자 문의 관리)\s*</)?.[1];
    roots.push({ fn, label: `${caption ? `${caption} · ` : ""}${entry.routePath}${entry.kind === "page" ? " 페이지" : " API"} · ${fn.name}` });
  } }
  const reached = new Set<string>();
  const features: ReviewFeature[] = [];
  const add = (fn: FunctionInfo, label: string) => {
    const ids = new Set([fn.id]), queue = [{ id: fn.id, depth: 0 }];
    for (const current of queue) {
      if (current.depth >= 4) continue;
      for (const link of links.filter(l => l.from === current.id && l.status === "confirmed")) if (!ids.has(link.to)) { ids.add(link.to); queue.push({ id: link.to, depth: current.depth + 1 }); }
      if (ids.size >= 30) break;
    }
    ids.forEach(id => reached.add(id));
    const featureFacts = [...ids].flatMap(id => facts.get(id) ?? []);
    if (!featureFacts.length) return;
    features.push({ id: `feature-${features.length}`, label, facts: featureFacts, relations: links.filter(l => ids.has(l.from) && (ids.has(l.to) || l.status === "unresolved")),
      limitations: ["정적 참조·호출 관계는 런타임 입력 전파나 DB 저장 후 출력의 증명이 아닙니다.", ...(analysis.collection?.partial ? ["수집 제한으로 기능 일부가 누락될 수 있습니다."] : [])] });
  };
  roots.forEach(root => add(root.fn, root.label));
  for (const fn of functions) if (!reached.has(fn.id) && (facts.get(fn.id)?.some(f => ["input", "database", "sql", "role", "output"].includes(f.role)))) add(fn, `${fn.name} 함수 · 페이지 연결 미확인`);
  return features;
}
