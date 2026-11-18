/** Serializable contract for a future isolated runner. No credentials or arbitrary target URL. */
export type SqliRequestDraft = {
  version: "sqli-practice-v1";
  connectionId: string | null;
  repository: string;
  commitSha: string | null;
  findingId: string;
  target: { deploymentOrigin: string; apiPath: string; method: "GET"; inputLocation: "query"; parameter: string };
  baseline: { value: string };
  test: { value: string };
};

export type SqliResponseEvidence = {
  requestId: string;
  observedAt: string;
  outcome: "RESPONSE" | "NETWORK_ERROR" | "TIMEOUT" | "ACCESS_DENIED" | "BLOCKED" | "SIZE_LIMIT";
  statusCode: number | null;
  durationMs: number | null;
  body: string | null;
  bodyTruncated: boolean;
  errorMessage: string | null;
};

export type SqliAssessmentStatus = "NOT_RUN" | "INCONCLUSIVE" | "VULNERABILITY_CONFIRMED" | "NO_VULNERABLE_BEHAVIOR_OBSERVED";
export const sqliAssessmentLabels: Record<SqliAssessmentStatus, string> = {
  NOT_RUN: "미실행", INCONCLUSIVE: "판정 불가",
  VULNERABILITY_CONFIRMED: "취약점 확인", NO_VULNERABLE_BEHAVIOR_OBSERVED: "취약 동작 미관찰",
};

/** Server-owned run IDs and reviewed proof references will be required by a future integration. */
export type SqliComparisonResult = {
  runId: string;
  request: SqliRequestDraft;
  baseline: SqliResponseEvidence | null;
  test: SqliResponseEvidence | null;
  assessment: {
    status: Exclude<SqliAssessmentStatus, "NOT_RUN">;
    reason: string;
    evidenceReferences: string[];
  } | null;
};

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
