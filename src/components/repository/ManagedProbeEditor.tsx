"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { probeTargetKey, isMatchingProbeResult, probeRequestPreview, previousProbeObservations, type ProbeRequestDraft, type ProbeResult, type ProbeSession } from "@/lib/security-lab/probeTypes";
import type { SqliExecutionStatus } from "@/lib/security-lab/sqliTypes";
import type { ConfirmedPracticeTarget } from "@/types/securityPracticeTarget";
import type { ProbeHistory } from "./ProbeObservationHistory";
import { SecurityTestRecord } from "./SecurityTestRecord";
import styles from "./sqliRequestEditor.module.css";
export type ManagedProbeEditorProps<D extends ProbeRequestDraft> = { initialDraft: D; onBack: () => void; session?: ProbeSession<D> | null; onSessionChange?: (session: ProbeSession<D>) => void; recordContext?: { recordKey: string; codeLocation: string; confirmedTarget: ConfirmedPracticeTarget } };
export type ProbeEditorDefinition<D extends ProbeRequestDraft> = {
  kind: "SQL_INJECTION" | "XSS"; title: string; shortLabel: string; endpoint: "sqli" | "xss"; testValue: string; fixedBaseline?: string;
  testDescription: string; invalidInputs: string; validInputs: (baseline: string, test: string) => boolean;
  useHistory: () => ProbeHistory<D> | null; note: (result: ProbeResult<D>) => string;
  Comparison: ComponentType<{ result: ProbeResult<D> | null; attempted?: boolean }>;
};
export function ManagedProbeEditor<D extends ProbeRequestDraft>({ initialDraft, onBack, session, onSessionChange, recordContext, definition }: ManagedProbeEditorProps<D> & { definition: ProbeEditorDefinition<D> }) {
  const Comparison = definition.Comparison;
  const targetKey = probeTargetKey(initialDraft);
  const saved = session?.targetKey === targetKey && definition.validInputs(session.baseline, session.test) ? session : null;
  const [baseline, setBaseline] = useState(saved?.baseline ?? definition.fixedBaseline ?? initialDraft.baseline.value);
  const test = definition.testValue;
  const [status, setStatus] = useState<SqliExecutionStatus>({ allowed: false, reason: "서버 실행 승인을 아직 확인하지 않았습니다. 기본 상태는 실행 차단입니다." });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const restoredRequest = { ...initialDraft, baseline: { value: saved?.baseline ?? definition.fixedBaseline ?? initialDraft.baseline.value }, test: { value: test } };
  const [result, setResult] = useState<ProbeResult<D> | null>(() => isMatchingProbeResult(saved?.result, restoredRequest) ? saved!.result : null);
  const [initialResult, setInitialResult] = useState<ProbeResult<D> | null>(() => {
    const first = saved?.initialResult ?? saved?.result;
    return isMatchingProbeResult(first, restoredRequest) ? first : null;
  });
  const [recordOpen, setRecordOpen] = useState(false);
  const [attempted, setAttempted] = useState(saved?.attempted ?? Boolean(saved?.result));
  const history = definition.useHistory();
  const addObservation = history?.add;
  const [referenceId, setReferenceId] = useState("");
  const references = result ? previousProbeObservations(history?.results ?? [], result) : [];
  const reference = references.find(row => row.runId === referenceId);
  const manualInitial = reference ?? initialResult;
  useEffect(() => { if (result) addObservation?.(result); }, [result, addObservation]);
  const active = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const draft = useMemo<D>(() => ({ ...initialDraft, baseline: { value: baseline }, test: { value: test } }), [initialDraft, baseline, test]);
  useEffect(() => { onSessionChange?.({ targetKey, baseline, test, result, initialResult, attempted }); }, [targetKey, baseline, test, result, initialResult, attempted, onSessionChange]);
  useEffect(() => () => { const controller = active.current; active.current = null; controller?.abort(); }, []);
  useEffect(() => {
    if (!status.expiresAt) return;
    const timer = setTimeout(() => { setStatus({ allowed: false, reason: "실행 승인이 만료되었습니다. 다시 확인하세요." }); setConfirmed(false); }, Math.max(0, Date.parse(status.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [status.expiresAt]);
  const validInputs = definition.validInputs(baseline, test);
  const send = useCallback(async (action: "status" | "execute") => {
    if (inFlight.current || !draft.connectionId || (action === "execute" && (!status.allowed || !confirmed || !validInputs))) return;
    inFlight.current = true; setBusy(true); setConfirmed(false);
    if (action === "execute") { setResult(null); setAttempted(true); }
    const controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => controller.abort(), 125_000);
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(draft.connectionId)}/practice/${definition.endpoint}`, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, draft, ...(action === "execute" ? { confirmed: true } : {}) }),
      });
      const payload = await response.json();
      if (active.current !== controller) return;
      if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("서버 응답 형식을 확인하지 못했습니다. 자동 재시도하지 않습니다.");
      if (!response.ok) throw new Error(payload.reason ?? payload.message ?? "서버가 실행을 차단했습니다.");
      if (action === "status") {
        if (payload.allowed !== true || typeof payload.expiresAt !== "string" || Date.parse(payload.expiresAt) <= Date.now()
          || !Number.isFinite(Date.parse(payload.expiresAt)) || !Number.isSafeInteger(payload.remainingRequests) || payload.remainingRequests < 2
          || typeof payload.approvalId !== "string" || !payload.approvalId || typeof payload.targetId !== "string" || !payload.targetId) throw new Error("서버 실행 승인과 요청 예산을 확인하지 못했습니다.");
        setStatus(payload as SqliExecutionStatus);
      } else {
        if (!isMatchingProbeResult(payload.result, draft)) throw new Error("요청 대상·SHA·입력값과 일치하는 실제 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다.");
        setResult(payload.result as ProbeResult<D>);
        setInitialResult(previous => previous ?? payload.result as ProbeResult<D>);
        setStatus({ allowed: false, reason: "실행 예산을 사용했습니다. 추가 실행 전 서버 승인을 다시 확인하세요." });
      }
    } catch (error) {
      if (active.current !== controller) return;
      setStatus({ allowed: false, reason: controller.signal.aborted ? "서버 응답 대기 시간이 초과되었습니다. 요청이 이미 전송됐을 수 있으므로 자동 재시도하지 않습니다."
        : error instanceof Error ? error.message : "서버 승인 확인 또는 요청이 실패했습니다." });
    } finally {
      clearTimeout(timer);
      if (active.current === controller) { active.current = null; inFlight.current = false; setBusy(false); }
    }
  }, [draft, status.allowed, confirmed, validInputs, definition]);
  return <section aria-label={`${definition.title} 요청 편집기`}>
    <h3>{definition.title} 요청 편집기</h3>
    <p>취약점 후보에 대한 GET · 쿼리 파라미터 1개 요청을 준비합니다. 입력과 마지막 서버 결과는 준비 화면으로 돌아가도 유지되며 새로고침·화면 이탈 시 초기화됩니다.</p>
    <p>정적 분석 후보: {initialDraft.findingId} · 코드 위치: {recordContext?.codeLocation ?? "이전 후보 화면에서 확인"} · 분석 SHA: {initialDraft.commitSha ?? "미확인"}. 후보 탐지는 실제 {definition.shortLabel} 확인과 다릅니다.</p>
    <dl className="repository-metadata">
      <div><dt>대상 배포 URL</dt><dd><code>{draft.target.deploymentOrigin}</code></dd></div>
      <div><dt>API 경로</dt><dd><code>{draft.target.apiPath}</code></dd></div>
      <div><dt>HTTP 메서드</dt><dd>GET</dd></div>
      <div><dt>입력 위치 / 파라미터</dt><dd>query / <code>{draft.target.parameter}</code></dd></div>
    </dl>
    <div className={styles.grid}>
      <div><label>정상 요청 입력값 <input readOnly={definition.fixedBaseline !== undefined} disabled={busy} value={baseline} maxLength={128} onChange={event => { setBaseline(event.target.value); setConfirmed(false); setResult(null); setInitialResult(null); setAttempted(false); setStatus({ allowed: false, reason: "입력이 변경되었습니다. 실행 승인을 다시 확인하세요." }); }} /></label>
        <h4>정상 요청 미리보기 · 전송 안 됨</h4><pre className={styles.preview}>{probeRequestPreview(draft, "baseline")}</pre></div>
      <div><label>테스트 요청 입력값 <input readOnly value={test} /></label><p>{definition.testDescription}</p>
        <h4>테스트 요청 미리보기 · 전송 안 됨</h4><pre className={styles.preview}>{probeRequestPreview(draft, "test")}</pre></div>
    </div>
    <button type="button" className="secondary-action" disabled={busy || !draft.connectionId || !validInputs} onClick={() => void send("status")}>서버 실행 승인 확인 · 대상 요청 없음</button>
    <p id="sqli-execution-unavailable" role="status">{status.reason}</p>
    {status.allowed && <p>남은 요청: {status.remainingRequests}회 · 만료: {status.expiresAt} · 정상값과 테스트값을 각각 최대 1회 전송합니다.</p>}
    {!validInputs && <p role="alert">{definition.invalidInputs}</p>}
    <p>기초 실습 서버는 연결하지 않습니다. 서버가 등록·검토한 테스트 전용 배포 1개만 허용하며, 임의 외부 URL이나 인증 쿠키·GitHub/Vercel 토큰을 대상에 전달하지 않습니다.</p>
    <label><input type="checkbox" disabled={busy || !status.allowed} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> 위 대상과 두 요청 내용을 확인했으며 전송에 동의합니다.</label>
    <button type="button" className="secondary-action" disabled={busy || !status.allowed || !confirmed || !validInputs} aria-describedby="sqli-execution-unavailable" onClick={() => void send("execute")}>{busy ? "서버 검증 / 요청 처리 중…" : status.allowed ? "정상값·테스트값 요청 전송" : "테스트 실행 환경 연결 전"}</button>
    <button type="button" className="secondary-action" disabled={busy} onClick={onBack}>실습 준비로 돌아가기</button>
    <Comparison result={result} attempted={attempted} />
    {result && <section aria-label="수정 전후 커밋별 HTTP 비교">
      <h4>수정 후 재검증 · 이전 커밋과 비교</h4>
      <p>각 실행은 해당 SHA의 분석·확정 대상·별도 승인을 통과해야 합니다. 같은 저장소 연결의 이전 관찰을 직접 선택하면 읽기 전용으로 비교합니다. 이전 결과를 현재 검사 결과로 복원하거나 재사용하지 않습니다. 최근 10회 관찰만 화면 세션에 보관합니다.</p>
      <label>비교할 이전 커밋의 실행<select value={reference?.runId ?? ""} onChange={event => setReferenceId(event.target.value)}><option value="">직접 선택</option>{references.map(row => <option key={row.runId} value={row.runId}>{row.request.commitSha} · {row.runId}</option>)}</select></label>
      {!references.length && <p>다른 커밋의 이전 HTTP 관찰이 없습니다. 현재 화면을 유지한 채 수정 커밋을 재분석하고 새 승인을 받아 검사하세요.</p>}
      {reference && <><p>배포 URL·경로·파라미터·입력값이 달라질 수 있습니다. 아래 두 관찰의 조건과 수정 내용을 직접 확인하세요. 차이가 있어도 수정 성공으로 자동 판정하지 않습니다.</p>
        <div className={styles.grid}><article><h5>이전 커밋 · 비교 참조</h5><pre>{definition.note(reference)}</pre></article><article><h5>현재 커밋 · 독립 실행</h5><pre>{definition.note(result)}</pre></article></div>
        <details><summary>이전 커밋의 원본 HTTP 응답 보기</summary><Comparison result={reference} /></details>
      </>}
    </section>}
    {initialResult && initialResult.runId !== result?.runId && <section aria-label="최초·후속 HTTP 관찰 비교">
      <h4>최초·후속 HTTP 관찰 비교</h4>
      <p>최초 실행 {initialResult.runId} → 후속 실행 {result?.runId ?? "결과 미확인"}. 동일 분석 SHA·대상·입력쌍만 비교합니다. 코드 수정 완료 또는 취약점 해결을 뜻하지 않습니다.</p>
      <div className={styles.grid}><article><h5>최초 관찰</h5><pre>{definition.note(initialResult)}</pre></article><article><h5>후속 관찰</h5><pre>{result ? definition.note(result) : "후속 결과를 확인하지 못했습니다. 최초 관찰은 보존됩니다."}</pre></article></div>
      <details><summary>최초 원본 HTTP 응답 보기</summary><Comparison result={initialResult} /></details>
    </section>}
    {recordContext && <section aria-label={`${definition.shortLabel} 검사 기록 연결`}>
      <button type="button" onClick={() => setRecordOpen(previous => !previous)}>{recordOpen ? "검사 결과 기록 닫기" : "검사 결과 기록으로 이동"}</button>
      <p>사용자 판단과 수정 후 재검증은 기존 수동 기록에 작성합니다. SHA가 바뀌면 재분석·새 대상 확정·별도 승인이 필요하며 이전 HTTP 결과는 새 검사로 재사용하지 않습니다.</p>
      {recordOpen && <SecurityTestRecord source="MANUAL" kind={definition.kind} recordKey={recordContext.recordKey}
        confirmedTarget={recordContext.confirmedTarget} initial={{ apiPath: draft.target.apiPath, method: "GET", codeLocation: recordContext.codeLocation }}
        observations={manualInitial ? { initial: definition.note(manualInitial), latest: result && result.runId !== manualInitial.runId ? definition.note(result) : undefined } : undefined} />}
    </section>}
  </section>;
}
