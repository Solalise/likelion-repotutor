import { isMatchingProbeResult, probeTargetKey, type ProbeRequestDraft, type ProbeResponseEvidence, type ProbeResult } from "./probeTypes";
export type SqliRequestDraft = ProbeRequestDraft & { version: "sqli-practice-v1" };
export type SqliResponseEvidence = ProbeResponseEvidence;
export type SqliAssessmentStatus = "NOT_RUN" | "INCONCLUSIVE" | "VULNERABILITY_CONFIRMED" | "NO_VULNERABLE_BEHAVIOR_OBSERVED";
export const sqliAssessmentLabels: Record<SqliAssessmentStatus, string> = {
  NOT_RUN: "미실행", INCONCLUSIVE: "판정 불가",
  VULNERABILITY_CONFIRMED: "취약점 확인", NO_VULNERABLE_BEHAVIOR_OBSERVED: "취약 동작 미관찰",
};

/** Server-owned run IDs and reviewed proof references will be required by a future integration. */
export type SqliComparisonResult = ProbeResult<SqliRequestDraft>;

export type SqliExecutionStatus = {
  allowed: boolean;
  reason: string;
  approvalId?: string;
  targetId?: string;
  expiresAt?: string;
  remainingRequests?: number;
};

/** No status/timing heuristics. Until a trusted result adapter exists, evidence remains inconclusive. */
export function sqliDisplayAssessment(result: SqliComparisonResult | null): { status: SqliAssessmentStatus; reason: string } {
  if (!result) return { status: "NOT_RUN", reason: "테스트 실행 환경 연결 전입니다. 요청을 보내지 않았으며 실제 응답 증거가 없습니다." };
  return { status: "INCONCLUSIVE", reason: "판정 불가: 상태 코드·시간·본문 차이는 SQLi 성공 또는 실패의 증명이 아닙니다. 실제 서버의 쿼리 실행 근거가 추가로 필요합니다." };
}

export function sqliRequestPreview(request: SqliRequestDraft, variant: "baseline" | "test") {
  const url = new URL(request.target.apiPath, request.target.deploymentOrigin);
  url.searchParams.set(request.target.parameter, request[variant].value);
  return `${request.target.method} ${url.href}`;
}

/** Client-session state only; approval and active requests are never retained. */
export type SqliEditorSession = {
  targetKey: string;
  baseline: string;
  test: string;
  result: SqliComparisonResult | null;
  initialResult?: SqliComparisonResult | null;
  attempted?: boolean;
};

export const sqliTargetKey = probeTargetKey;
export function isMatchingSqliResult(value: unknown, expected: SqliRequestDraft): value is SqliComparisonResult { return isMatchingProbeResult(value, expected); }

export function sqliHttpDifference(result: SqliComparisonResult) {
  const { baseline, test } = result;
  const complete = baseline?.outcome === "RESPONSE" && test?.outcome === "RESPONSE";
  return {
    statusChanged: complete ? baseline.statusCode !== test.statusCode : null,
    bodyChanged: complete && !baseline.bodyTruncated && !test.bodyTruncated ? baseline.body !== test.body : null,
  };
}

/** A user may copy this summary into MANUAL notes; it is not stored server evidence. */
export function sqliObservationNote(result: SqliComparisonResult): string {
  const diff = sqliHttpDifference(result);
  return ["사용자가 복사한 HTTP 관찰 요약 · 서버 미검증 수동 메모 · SQLi 확정 아님",
    `실행 ID: ${result.runId}`, `분석 SHA: ${result.request.commitSha}`,
    `대상: GET ${result.request.target.deploymentOrigin}${result.request.target.apiPath} · query/${result.request.target.parameter}`,
    `입력쌍: 정상 ${result.request.baseline.value} · 고정 테스트 ${result.request.test.value}`,
    `정상: ${result.baseline?.outcome ?? "미실행"} · HTTP ${result.baseline?.statusCode ?? "없음"}`,
    `테스트: ${result.test?.outcome ?? "미실행"} · HTTP ${result.test?.statusCode ?? "없음"}`,
    `본문: ${diff.bodyChanged === null ? "완전한 비교 불가" : diff.bodyChanged ? "차이 있음" : "동일"}`,
    "원본 응답은 현재 화면 세션에만 보관됩니다. 이 메모는 서버 검증 근거를 영구 저장한 것이 아닙니다."].join("\n");
}

export function retainSqliObservation(history: SqliComparisonResult[], result: SqliComparisonResult): SqliComparisonResult[] {
  if (!isMatchingSqliResult(result, result.request) || history.some(row => row.runId === result.runId)) return history;
  return [...history, result].slice(-10);
}

/** References are explicitly selected; never hydrate a new request with old evidence. */
export function previousSqliObservations(history: SqliComparisonResult[], current: SqliComparisonResult): SqliComparisonResult[] {
  return history.filter(row => row.runId !== current.runId && row.request.connectionId === current.request.connectionId
    && row.request.repository === current.request.repository && row.request.commitSha !== current.request.commitSha);
}
