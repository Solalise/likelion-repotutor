import { describe, expect, it } from "vitest";
import { isSafeSqliPair, safeSqliProbe } from "./sqliProbe";
import { parseSqliDraft } from "./sqliPolicy";
import { previousSqliObservations, retainSqliObservation, isMatchingSqliResult, sqliHttpDifference, sqliObservationNote, type SqliComparisonResult, type SqliRequestDraft } from "./sqliTypes";

const draft: SqliRequestDraft = { version: "sqli-practice-v1", connectionId: "connection", repository: "org/repo", commitSha: "a".repeat(40), findingId: "sqli:route:1",
  target: { deploymentOrigin: "https://fixture.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q" }, baseline: { value: "normal" }, test: { value: safeSqliProbe.value } };
function observation(): SqliComparisonResult {
  const evidence = { requestId: "request", observedAt: "2026-11-19T00:00:00Z", outcome: "RESPONSE" as const, statusCode: 200, durationMs: 1, body: "normal", bodyTruncated: false, errorMessage: null };
  return { runId: "run", request: draft, baseline: evidence, test: { ...evidence, requestId: "test", statusCode: 500, body: "error" }, assessment: { status: "INCONCLUSIVE", reason: "HTTP only", evidenceReferences: [] } };
}
describe("fixed SQLi observation flow", () => {
  it("retains at most ten independent observations and filters prior commits by repository connection", () => {
    let history: SqliComparisonResult[] = [];
    for (let i = 0; i < 12; i++) history = retainSqliObservation(history, { ...observation(), runId: `run-${i}` });
    expect(history).toHaveLength(10); expect(history[0].runId).toBe("run-2");
    expect(retainSqliObservation(history, history[0])).toBe(history);
    const current = { ...observation(), request: { ...draft, commitSha: "b".repeat(40) } };
    expect(previousSqliObservations(history, current)).toHaveLength(10);
    expect(previousSqliObservations(history, { ...current, request: { ...current.request, connectionId: "other" } })).toEqual([]);
    expect(previousSqliObservations(history, { ...current, request: { ...current.request, repository: "org/other" } })).toEqual([]);
    expect(previousSqliObservations(history, observation())).toEqual([]);
  });
  it("accepts only the predefined probe and a bounded plain baseline on the server", () => {
    expect(parseSqliDraft(draft)).toEqual(draft);
    for (const value of ["custom", "", safeSqliProbe.value + " "]) expect(() => parseSqliDraft({ ...draft, test: { value } })).toThrow();
    for (const value of ["", "   ", "x'", "x&other=value", "x y", "x--", "1 OR true", "x".repeat(129), "x\n"]) expect(isSafeSqliPair(value, safeSqliProbe.value)).toBe(false);
  });
  it("rejects mismatched targets, commits, input pairs and fabricated verdicts", () => {
    const r = observation(); expect(isMatchingSqliResult(r, draft)).toBe(true);
    for (const changed of [{ ...draft, commitSha: "b".repeat(40) }, { ...draft, findingId: "sqli:other" }, { ...draft, target: { ...draft.target, parameter: "other" } }, { ...draft, baseline: { value: "other" } }]) expect(isMatchingSqliResult(r, changed)).toBe(false);
    for (const changed of [{ ...r, baseline: null }, { ...r, assessment: { ...r.assessment, status: "VULNERABILITY_CONFIRMED" } }, { ...r, test: { ...r.test, body: "x".repeat(4001) } }, { ...r, test: { ...r.test, observedAt: "invalid" } }]) expect(isMatchingSqliResult(changed, draft)).toBe(false);
    expect(isMatchingSqliResult({ request: null }, draft)).toBe(false);
  });
  it("compares observations without turning truncation or network errors into a verdict", () => {
    const r = observation(); expect(sqliHttpDifference(r)).toEqual({ statusChanged: true, bodyChanged: true });
    expect(sqliHttpDifference({ ...r, test: { ...r.test!, bodyTruncated: true } }).bodyChanged).toBeNull();
    expect(sqliHttpDifference({ ...r, test: { ...r.test!, outcome: "TIMEOUT", statusCode: null, body: null } })).toEqual({ statusChanged: null, bodyChanged: null });
    expect(sqliObservationNote(r)).toContain("서버 미검증 수동 메모");
    expect(sqliObservationNote(r)).toContain(r.runId);
    expect(sqliObservationNote(r)).not.toContain("취약점 확인 완료");
  });
});
