import "server-only";
import { createHash } from "node:crypto";
import { normalizeVercelUrl } from "@/lib/repository/deployment";
import type { SqliRequestDraft } from "./sqliTypes";
import { managedSqliRegistry, type ManagedSqliTarget, type SqliExecutionApproval } from "./sqliRegistry";

export class SqliExecutionError extends Error {
  constructor(message: string, public readonly status = 403) { super(message); }
}

export function approvalFingerprint(target: ManagedSqliTarget, approval: SqliExecutionApproval) {
  return createHash("sha256").update(JSON.stringify([target.id, target.origin, target.path, target.method, target.parameter,
    target.projectId, target.deploymentId, target.reviewReference, approval.id, approval.userId, approval.connectionId,
    approval.analysisRunId, approval.repository, approval.commitSha, approval.findingId, approval.deploymentVersion,
    approval.issuedAt, approval.expiresAt, approval.maxRequests])).digest("hex");
}

export function selectSqliApproval(userId: string, draft: SqliRequestDraft, now = Date.now()) {
  const registry = managedSqliRegistry(), target = registry.target;
  if (!target) throw new SqliExecutionError("서버에 등록·검토된 테스트 전용 배포가 없습니다. 실제 요청은 실행할 수 없습니다.");
  let validOrigin = false;
  try { validOrigin = normalizeVercelUrl(target.origin) === target.origin; } catch { /* fail closed */ }
  if (!validOrigin || !/^[a-z0-9-]+\.vercel\.app$/.test(new URL(target.origin).hostname)
    || !/^\/api\/[A-Za-z0-9/_-]+$/.test(target.path) || target.path.includes("//")
    || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(target.parameter) || target.method !== "GET"
    || target.isolatedTestOnly !== true || target.syntheticDataOnly !== true || target.readOnlyDatabase !== true
    || target.sideEffectFreeApi !== true || !target.reviewReference?.trim() || !target.id || !target.projectId || !target.deploymentId) {
    throw new SqliExecutionError("서버의 테스트 대상 설정·격리·읽기 전용 DB·무부작용 API 검토 근거가 유효하지 않습니다.");
  }
  if (draft.target.deploymentOrigin !== target.origin || draft.target.apiPath !== target.path || draft.target.method !== target.method
    || draft.target.inputLocation !== "query" || draft.target.parameter !== target.parameter) {
    throw new SqliExecutionError("편집기의 호스트·API 경로·GET 메서드·쿼리 파라미터가 서버에 등록된 단일 대상과 일치하지 않습니다.");
  }
  const matches = registry.approvals.filter(row => row.targetId === target.id && row.userId === userId
    && row.connectionId === draft.connectionId && row.repository === draft.repository && row.commitSha === draft.commitSha && row.findingId === draft.findingId);
  if (matches.length !== 1) throw new SqliExecutionError("현재 사용자·대상·분석 후보에 대한 단일 실행 승인이 없습니다. 소유권 확인은 실행 승인이 아닙니다.");
  const approval = matches[0], issued = Date.parse(approval.issuedAt), expires = Date.parse(approval.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now || expires <= now || expires <= issued
    || expires - issued > 60 * 60_000 || !Number.isSafeInteger(approval.maxRequests) || approval.maxRequests < 2 || approval.maxRequests > 6
    || approval.maxRequests % 2 !== 0 || !approval.id || !approval.analysisRunId
    || !Number.isSafeInteger(approval.deploymentVersion) || approval.deploymentVersion < 0) {
    throw new SqliExecutionError("실행 승인이 만료되었거나 만료·요청 횟수 설정이 유효하지 않습니다 (최대 1시간·6회).");
  }
  return { target, approval };
}

export function parseSqliDraft(value: unknown): SqliRequestDraft {
  const row = value as SqliRequestDraft;
  if (!row || typeof row !== "object" || Array.isArray(row) || row.version !== "sqli-practice-v1"
    || typeof row.connectionId !== "string" || !/^[-\w]{1,160}$/.test(row.connectionId)
    || typeof row.repository !== "string" || row.repository.length > 300
    || typeof row.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(row.commitSha)
    || typeof row.findingId !== "string" || !row.findingId.startsWith("sqli:") || row.findingId.length > 1024
    || !row.target || typeof row.target.deploymentOrigin !== "string" || row.target.deploymentOrigin.length > 512
    || typeof row.target.apiPath !== "string" || row.target.apiPath.length > 256
    || row.target.method !== "GET" || row.target.inputLocation !== "query" || typeof row.target.parameter !== "string"
    || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(row.target.parameter)
    || !row.baseline || !row.test || typeof row.baseline.value !== "string" || typeof row.test.value !== "string"
    || [row.baseline.value, row.test.value].some(input => Buffer.byteLength(input) > 512 || /[\u0000-\u001f\u007f]/.test(input))) {
    throw new SqliExecutionError("연결 저장소의 SQLi 후보와 GET/query 입력값(각 UTF-8 512바이트 이내)이 필요합니다.", 400);
  }
  // Copy only known fields; tokens, headers and additional request options cannot reach the runner.
  return { version: row.version, connectionId: row.connectionId, repository: row.repository, commitSha: row.commitSha, findingId: row.findingId,
    target: { deploymentOrigin: row.target.deploymentOrigin, apiPath: row.target.apiPath, method: "GET", inputLocation: "query", parameter: row.target.parameter },
    baseline: { value: row.baseline.value }, test: { value: row.test.value } };
}
