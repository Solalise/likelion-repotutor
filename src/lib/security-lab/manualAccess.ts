import { practiceMethods } from "./practiceTarget";
import { validateResourceId } from "./projectPlan";
import { validApiPath } from "@/types/securityTestRecord";
import { practiceTargetIdentity, type ConfirmedPracticeTarget } from "@/types/securityPracticeTarget";

export type AccessDecision = "ALLOW" | "DENY" | "UNKNOWN";
export const accessDecisionLabels: Record<AccessDecision, string> = { ALLOW: "접근 허용", DENY: "접근 거부", UNKNOWN: "확인 불가" };
export type AccessKind = "IDOR" | "AUTHORIZATION";
export type AccessPlan = { version: "manual-access-v1" } & (
  { kind: "IDOR"; accounts: [{ alias: string; resourceId: string }, { alias: string; resourceId: string }]; identifierLocation: string; expected: Record<"A_OWN" | "A_OTHER" | "B_OWN" | "B_OTHER", AccessDecision> }
  | { kind: "AUTHORIZATION"; roles: string[]; operations: { id: string; name: string; apiPath: string; method: string; expected: Record<string, AccessDecision> }[] }
);
export type AccessCase = { id: string; actor: string; resource: string; owner: string; operation: string; apiPath: string; method: string; expected: AccessDecision };
export type AccessObservation = { statusCode: number | null; access: AccessDecision; responseSummary: string; rationale: string };
export type AccessRound = { commitSha: string; performedAt: string; environmentConfirmed: boolean; observations: Record<string, AccessObservation> };
export type ManualAccessComparison = { version: "manual-access-results-v1"; targetIdentity: string; initial: AccessRound; retest: AccessRound };
export type AccessBinding = { repositoryFullName: string; commitSha: string; recordKey: string };

const sensitive = /["']?\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*:|\bbearer\s+[\w.+/=-]+|["']?(?:password|passwd|token|secret|access_token|refresh_token|id_token|session_token|session[_-]?(?:id|cookie)|api[_-]?key|client_secret|비밀번호|인증토큰|토큰|세션쿠키)["']?\s*[:=]\s*["']?[^\s"',;}]+|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+|https?:\/\/[^\s/@]+:[^\s/@]+@/i;
export function containsCredentialMaterial(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof value === "string") return sensitive.test(value);
  return Boolean(value && typeof value === "object" && Object.values(value).some(v => containsCredentialMaterial(v, depth + 1)));
}
const fail = (): never => { throw new Error("형식·대상·정책을 확인하세요. 인증 헤더·쿠키·비밀번호·토큰·원본 HTTP/HAR은 가져오거나 저장할 수 없습니다."); };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
function keys(row: Record<string, unknown>, allowed: string[]) { if (Object.keys(row).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(row, k))) fail(); }
function text(value: unknown, max: number, required = true): string { if (typeof value !== "string" || value.length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || containsCredentialMaterial(value)) return fail(); return value; }
function decision(value: unknown): AccessDecision { if (value !== "ALLOW" && value !== "DENY" && value !== "UNKNOWN") return fail(); return value; }
export function splitRoles(value: string): string[] { return value.split(/[,\n]/).map(v => v.trim()).filter(Boolean); }

/** Canonical, bounded user-declared policy; no inference or execution. */
export function parseAccessPlan(value: unknown, target: Pick<ConfirmedPracticeTarget, "apiPath" | "method">, kind: AccessKind): AccessPlan {
  const row = object(value); if (containsCredentialMaterial(row) || JSON.stringify(row).length > 4000 || row.version !== "manual-access-v1" || row.kind !== kind) return fail();
  if (!validApiPath(target.apiPath) || !practiceMethods.includes(target.method as typeof practiceMethods[number])) return fail();
  if (kind === "IDOR") {
    keys(row, ["version", "kind", "accounts", "identifierLocation", "expected"]);
    if (!Array.isArray(row.accounts) || row.accounts.length !== 2) return fail();
    const accounts = row.accounts.map(value => { const a = object(value); keys(a, ["alias", "resourceId"]); const alias = text(a.alias, 80).trim(), resourceId = text(a.resourceId, 80); if (validateResourceId(resourceId)) return fail(); return { alias, resourceId }; });
    if (accounts[0].alias === accounts[1].alias || accounts[0].resourceId === accounts[1].resourceId) return fail();
    const e = object(row.expected); keys(e, ["A_OWN", "A_OTHER", "B_OWN", "B_OTHER"]);
    return { version: "manual-access-v1", kind, accounts: [accounts[0], accounts[1]], identifierLocation: text(row.identifierLocation, 120), expected: { A_OWN: decision(e.A_OWN), A_OTHER: decision(e.A_OTHER), B_OWN: decision(e.B_OWN), B_OTHER: decision(e.B_OTHER) } };
  }
  keys(row, ["version", "kind", "roles", "operations"]);
  if (!Array.isArray(row.roles) || row.roles.length < 2 || row.roles.length > 4 || !Array.isArray(row.operations) || !row.operations.length || row.operations.length > 4) return fail();
  const roles = row.roles.map(v => text(v, 80).trim()); if (new Set(roles).size !== roles.length || roles.some(v => ["__proto__", "constructor", "prototype"].includes(v))) return fail();
  const operations = row.operations.map(value => {
    const op = object(value); keys(op, ["id", "name", "apiPath", "method", "expected"]);
    const id = text(op.id, 40), name = text(op.name, 80), apiPath = text(op.apiPath, 256), method = text(op.method, 16);
    if (!/^[a-z0-9_-]+$/.test(id) || !validApiPath(apiPath) || !practiceMethods.includes(method as typeof practiceMethods[number])) return fail();
    const e = object(op.expected); keys(e, roles); const expected = Object.fromEntries(roles.map(role => [role, decision(e[role])]));
    return { id, name, apiPath, method, expected };
  });
  if (new Set(operations.map(o => o.id)).size !== operations.length || operations[0].apiPath !== target.apiPath || operations[0].method !== target.method) return fail();
  return { version: "manual-access-v1", kind, roles, operations };
}
export function accessPlanFromTarget(target: ConfirmedPracticeTarget | undefined, kind: string): AccessPlan | null {
  if (!target?.details?.accessPlan || kind !== "IDOR" && kind !== "AUTHORIZATION") return null;
  return parseAccessPlan(JSON.parse(target.details.accessPlan), target, kind);
}
export function accessCases(plan: AccessPlan, target: Pick<ConfirmedPracticeTarget, "apiPath" | "method">): AccessCase[] {
  if (plan.kind === "AUTHORIZATION") return plan.operations.flatMap(op => plan.roles.map((role, index) => ({ id: `${op.id}:role-${index}`, actor: role, resource: "해당 작업", owner: "역할 정책", operation: op.name, apiPath: op.apiPath, method: op.method, expected: op.expected[role] })));
  const [a, b] = plan.accounts;
  return [["A_OWN", a, a], ["A_OTHER", a, b], ["B_OWN", b, b], ["B_OTHER", b, a]].map(([id, actor, owner]) => {
    const account = actor as typeof a, resource = owner as typeof a, key = id as keyof typeof plan.expected;
    return { id: key, actor: account.alias, resource: resource.resourceId, owner: resource.alias, operation: `리소스 접근 · ${plan.identifierLocation}`, apiPath: target.apiPath, method: target.method, expected: plan.expected[key] };
  });
}
export function emptyAccessComparison(target: ConfirmedPracticeTarget, plan: AccessPlan, commitSha = ""): ManualAccessComparison {
  const round = (): AccessRound => ({ commitSha, performedAt: "", environmentConfirmed: false, observations: Object.fromEntries(accessCases(plan, target).map(row => [row.id, { statusCode: null, access: "UNKNOWN", responseSummary: "", rationale: "" }])) });
  return { version: "manual-access-results-v1", targetIdentity: practiceTargetIdentity(target), initial: round(), retest: round() };
}
function canonicalTime(value: string): boolean { try { return Boolean(value && new Date(value).toISOString() === value); } catch { return false; } }
export function parseAccessRound(value: unknown, cases: AccessCase[], now = Date.now()): AccessRound {
  const r = object(value); keys(r, ["commitSha", "performedAt", "environmentConfirmed", "observations"]);
  const commitSha = text(r.commitSha, 40, false), performedAt = text(r.performedAt, 24, false);
  if (commitSha && !/^[a-f0-9]{40}$/.test(commitSha) || performedAt && (!canonicalTime(performedAt) || Date.parse(performedAt) > now) || typeof r.environmentConfirmed !== "boolean") return fail();
  const raw = object(r.observations); keys(raw, cases.map(row => row.id));
  const observations = Object.fromEntries(cases.map(row => { const o = object(raw[row.id]); keys(o, ["statusCode", "access", "responseSummary", "rationale"]); if (o.statusCode !== null && (!Number.isInteger(o.statusCode) || (o.statusCode as number) < 100 || (o.statusCode as number) > 599)) return fail(); return [row.id, { statusCode: o.statusCode as number | null, access: decision(o.access), responseSummary: text(o.responseSummary, 600, false), rationale: text(o.rationale, 240, false) }]; }));
  return { commitSha, performedAt, environmentConfirmed: r.environmentConfirmed, observations };
}
export function parseAccessComparison(value: unknown, target: ConfirmedPracticeTarget, plan: AccessPlan, analysisSha: string, now = Date.now()): ManualAccessComparison {
  const r = object(value); keys(r, ["version", "targetIdentity", "initial", "retest"]);
  if (r.version !== "manual-access-results-v1" || r.targetIdentity !== practiceTargetIdentity(target) || containsCredentialMaterial(r)) return fail();
  const cases = accessCases(plan, target), initial = parseAccessRound(r.initial, cases, now), retest = parseAccessRound(r.retest, cases, now);
  if (initial.commitSha && initial.commitSha !== analysisSha) return fail();
  if (!accessChronologyValid(initial, retest)) return fail();
  return { version: "manual-access-results-v1", targetIdentity: practiceTargetIdentity(target), initial, retest };
}
export function accessChronologyValid(initial: AccessRound, retest: AccessRound): boolean { return !initial.performedAt || !retest.performedAt || Date.parse(initial.performedAt) <= Date.parse(retest.performedAt); }
export function accessRoundReady(round: AccessRound | undefined, now: number): boolean {
  return Boolean(round && round.environmentConfirmed && /^[a-f0-9]{40}$/.test(round.commitSha) && canonicalTime(round.performedAt) && Date.parse(round.performedAt) <= now);
}
export function observedAccess(round: AccessRound | undefined, observation: AccessObservation | undefined, now: number): AccessDecision {
  if (!accessRoundReady(round, now) || !observation || !Number.isInteger(observation.statusCode) || observation.statusCode! < 100 || observation.statusCode! > 599 || !observation.responseSummary.trim() || !observation.rationale.trim()) return "UNKNOWN";
  return observation.access;
}
export function accessRoundComplete(round: AccessRound | undefined, now: number): boolean { return Boolean(round && accessRoundReady(round, now) && Object.keys(round.observations).length && Object.values(round.observations).every(o => o.responseSummary.trim() && o.rationale.trim() && (o.access === "UNKNOWN" || observedAccess(round, o, now) !== "UNKNOWN"))); }
export function assessAccess(expected: AccessDecision, observed: AccessDecision): "MATCH" | "SUSPECTED_VIOLATION" | "UNEXPECTED_DENIAL" | "UNKNOWN" {
  if (expected === "UNKNOWN" || observed === "UNKNOWN") return "UNKNOWN";
  return expected === observed ? "MATCH" : expected === "DENY" ? "SUSPECTED_VIOLATION" : "UNEXPECTED_DENIAL";
}
export const accessAssessmentLabels = { MATCH: "기대 정책과 일치 (사용자 관찰)", SUSPECTED_VIOLATION: "권한 정책 위반 의심 · 서버 미검증", UNEXPECTED_DENIAL: "예상 밖 접근 거부 · 원인 확인 필요", UNKNOWN: "확인 불가" };
export function accessObservationDifference(a: AccessObservation, b: AccessObservation) { return { statusChanged: a.statusCode === null || b.statusCode === null ? null : a.statusCode !== b.statusCode, summaryChanged: !a.responseSummary || !b.responseSummary ? null : a.responseSummary !== b.responseSummary }; }
export function accessPairDifferences(plan: AccessPlan, target: ConfirmedPracticeTarget, round: AccessRound) {
  const cases = accessCases(plan, target);
  const pairs = plan.kind === "IDOR" ? [[cases[0], cases[1]], [cases[2], cases[3]]]
    : plan.operations.flatMap(op => { const group = cases.filter(row => row.id.startsWith(`${op.id}:`)); return group.slice(1).map(row => [group[0], row]); });
  return pairs.map(([a,b]) => ({ label: `${a.actor}/${a.resource} ↔ ${b.actor}/${b.resource} · ${a.operation}`, ...accessObservationDifference(round.observations[a.id], round.observations[b.id]) }));
}
export function accessImportTemplate(binding: AccessBinding, target: ConfirmedPracticeTarget, phase: "initial" | "retest", round: AccessRound) { return { version: "manual-access-import-v1", ...binding, targetIdentity: practiceTargetIdentity(target), phase, round }; }
export function parseAccessImport(value: string, binding: AccessBinding, target: ConfirmedPracticeTarget, plan: AccessPlan, phase: "initial" | "retest", now = Date.now()): AccessRound {
  if (value.length > 32000) return fail();
  const r = object(JSON.parse(value)); keys(r, ["version", "repositoryFullName", "commitSha", "recordKey", "targetIdentity", "phase", "round"]);
  if (containsCredentialMaterial(r) || r.version !== "manual-access-import-v1" || r.repositoryFullName !== binding.repositoryFullName || r.commitSha !== binding.commitSha || r.recordKey !== binding.recordKey || r.targetIdentity !== practiceTargetIdentity(target) || r.phase !== phase) return fail();
  const round = parseAccessRound(r.round, accessCases(plan, target), now); if (phase === "initial" && round.commitSha !== binding.commitSha) return fail(); return round;
}
export function accessRoundSummary(plan: AccessPlan, target: ConfirmedPracticeTarget, round: AccessRound, now: number): string {
  const lines = ["사용자 직접 입력·가져오기 관찰 · 서버 미검증 · 취약점 확정 아님", `관찰 SHA(사용자 진술): ${round.commitSha || "미입력"} · 일시: ${round.performedAt || "미입력"}`,
    ...accessCases(plan, target).map(row => { const o = round.observations[row.id], actual = observedAccess(round, o, now); return `${row.actor} / ${row.resource} / ${row.operation}: 기대 ${accessDecisionLabels[row.expected]}, 관찰 ${accessDecisionLabels[actual]}, HTTP ${o?.statusCode ?? "없음"} · ${accessAssessmentLabels[assessAccess(row.expected, actual)]}`; })];
  const summary = lines.join("\n"); return summary.length > 3800 ? summary.slice(0, 3800) + "\n(일부 요약 생략 · 상세 비교표 참조)" : summary;
}
