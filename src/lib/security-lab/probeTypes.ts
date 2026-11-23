/** Serializable contract for a future isolated runner. No credentials or arbitrary target URL. */
export type ProbeRequestDraft = {
  version: "sqli-practice-v1" | "xss-practice-v1";
  connectionId: string | null;
  repository: string;
  commitSha: string | null;
  findingId: string;
  target: { deploymentOrigin: string; apiPath: string; method: "GET"; inputLocation: "query"; parameter: string; reflectionLocation?: string; reflectionContext?: "HTML_TEXT" | "HTML_ATTRIBUTE" | "UNKNOWN" };
  baseline: { value: string };
  test: { value: string };
};

export type ProbeResponseEvidence = {
  contentType?: string | null;
  requestId: string;
  observedAt: string;
  outcome: "RESPONSE" | "NETWORK_ERROR" | "TIMEOUT" | "ACCESS_DENIED" | "BLOCKED" | "SIZE_LIMIT";
  statusCode: number | null;
  durationMs: number | null;
  body: string | null;
  bodyTruncated: boolean;
  errorMessage: string | null;
};


export type ProbeResult<D extends ProbeRequestDraft = ProbeRequestDraft> = {
  runId: string; request: D; baseline: ProbeResponseEvidence | null; test: ProbeResponseEvidence | null;
  assessment: { status: "INCONCLUSIVE" | "VULNERABILITY_CONFIRMED" | "NO_VULNERABLE_BEHAVIOR_OBSERVED"; reason: string; evidenceReferences: string[] } | null;
};
export type ProbeSession<D extends ProbeRequestDraft> = { targetKey: string; baseline: string; test: string; result: ProbeResult<D> | null; initialResult?: ProbeResult<D> | null; attempted?: boolean };
export function probeTargetKey(draft: ProbeRequestDraft): string {
  const parts = [draft.version, draft.connectionId, draft.repository, draft.commitSha, draft.findingId,
    draft.target.deploymentOrigin, draft.target.apiPath, draft.target.method, draft.target.inputLocation, draft.target.parameter];
  if (draft.version === "xss-practice-v1") parts.push(draft.target.reflectionLocation ?? "", draft.target.reflectionContext ?? "");
  return JSON.stringify(parts);
}

export function isMatchingProbeResult<D extends ProbeRequestDraft>(value: unknown, expected: D): value is ProbeResult<D> {
  try {
    const r = value as ProbeResult<D>;
    if (!r || typeof r.runId !== "string" || !r.runId || r.runId.length > 200 || !r.request
      || probeTargetKey(r.request) !== probeTargetKey(expected) || r.request.baseline.value !== expected.baseline.value
      || r.request.test.value !== expected.test.value || r.assessment?.status !== "INCONCLUSIVE"
      || typeof r.assessment.reason !== "string" || !Array.isArray(r.assessment.evidenceReferences)
      || r.assessment.evidenceReferences.length !== 0) return false;
    return [r.baseline, r.test].every(e => e !== null && typeof e === "object" && typeof e.requestId === "string" && e.requestId.length > 0
      && typeof e.observedAt === "string" && Number.isFinite(Date.parse(e.observedAt))
      && ["RESPONSE", "NETWORK_ERROR", "TIMEOUT", "ACCESS_DENIED", "BLOCKED", "SIZE_LIMIT"].includes(e.outcome)
      && (e.statusCode === null || Number.isInteger(e.statusCode) && e.statusCode >= 100 && e.statusCode <= 599)
      && (e.outcome !== "RESPONSE" || e.statusCode !== null && typeof e.body === "string")
      && (e.durationMs === null || Number.isFinite(e.durationMs) && e.durationMs >= 0)
      && (e.body === null || typeof e.body === "string" && e.body.length <= 4000)
      && (e.contentType === undefined || e.contentType === null || typeof e.contentType === "string" && e.contentType.length <= 200)
      && typeof e.bodyTruncated === "boolean" && (e.errorMessage === null || typeof e.errorMessage === "string" && e.errorMessage.length <= 4000));
  } catch { return false; }
}

export function probeRequestPreview(request: ProbeRequestDraft, variant: "baseline" | "test") {
  const url = new URL(request.target.apiPath, request.target.deploymentOrigin);
  url.searchParams.set(request.target.parameter, request[variant].value);
  return `${request.target.method} ${url.href}`;
}
export function previousProbeObservations<D extends ProbeRequestDraft>(history: ProbeResult<D>[], current: ProbeResult<D>): ProbeResult<D>[] {
  return history.filter(row => row.runId !== current.runId && row.request.version === current.request.version && row.request.connectionId === current.request.connectionId && row.request.repository === current.request.repository && row.request.commitSha !== current.request.commitSha);
}
