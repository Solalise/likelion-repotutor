"use client";

import { useEffect, useRef, useState } from "react";
import { sqliAssessmentLabels, sqliDisplayAssessment, sqliRequestPreview, type SqliComparisonResult, type SqliExecutionStatus, type SqliRequestDraft, type SqliResponseEvidence } from "@/lib/security-lab/sqliTypes";
import styles from "./sqliRequestEditor.module.css";

function Evidence({ evidence }: { evidence: SqliResponseEvidence | null }) {
  return <>
    <dl className="repository-metadata">
      <div><dt>HTTP 상태 코드</dt><dd>{evidence?.statusCode ?? "응답 없음"}</dd></div>
      <div><dt>응답 시간</dt><dd>{evidence?.durationMs == null ? "측정되지 않음" : `${evidence.durationMs} ms`}</dd></div>
      <div><dt>요청 상태</dt><dd>{evidence?.outcome ?? "미실행"}</dd></div>
      <div><dt>오류 메시지</dt><dd>{evidence ? evidence.errorMessage ?? "없음" : "요청을 실행하지 않았습니다."}</dd></div>
    </dl>
    <h5>응답 본문</h5>
    <pre className={styles.body}>{evidence?.body == null ? "수신된 응답 본문이 없습니다." : evidence.body === "" ? "(빈 응답 본문)" : evidence.body}</pre>
    {evidence?.bodyTruncated && <p>응답 본문 일부만 표시합니다.</p>}
  </>;
}

/** Response bodies are rendered as text, never as HTML or scripts. */
export function SqliResponseComparison({ result }: { result: SqliComparisonResult | null }) {
  const assessment = sqliDisplayAssessment(result);
  return <section aria-label="SQLi 응답 비교">
    <h4>정상 응답 · 테스트 응답 비교</h4>
    <p role="status">결과 상태: <strong>{sqliAssessmentLabels[assessment.status]}</strong></p>
    <p>{assessment.reason}</p>
    <p>상태 구분: 미실행 / 판정 불가 / 취약점 확인 / 취약 동작 미관찰. 마지막 두 상태는 향후 서버 검증 근거가 연결되어야 사용할 수 있습니다.</p>
    <div className={styles.grid}>
      <article aria-label="정상 응답"><h4>정상 응답</h4><Evidence evidence={result?.baseline ?? null} /></article>
      <article aria-label="테스트 응답"><h4>테스트 응답</h4><Evidence evidence={result?.test ?? null} /></article>
    </div>
    <p>상태 코드·시간·본문 차이만으로 SQLi 성공을 추정하지 않습니다. 취약 동작 미관찰도 서비스 전체의 안전을 의미하지 않습니다.</p>
  </section>;
}

export function SqliRequestEditor({ initialDraft, onBack }: { initialDraft: SqliRequestDraft; onBack: () => void }) {
  const [baseline, setBaseline] = useState(initialDraft.baseline.value);
  const [test, setTest] = useState(initialDraft.test.value);
  const [status, setStatus] = useState<SqliExecutionStatus>({ allowed: false, reason: "서버 실행 승인을 아직 확인하지 않았습니다. 기본 상태는 실행 차단입니다." });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SqliComparisonResult | null>(null);
  const active = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const draft: SqliRequestDraft = { ...initialDraft, baseline: { value: baseline }, test: { value: test } };
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!status.expiresAt) return;
    const timer = setTimeout(() => { setStatus({ allowed: false, reason: "실행 승인이 만료되었습니다. 다시 확인하세요." }); setConfirmed(false); }, Math.max(0, Date.parse(status.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [status.expiresAt]);
  const validInputs = [baseline, test].every(value => new TextEncoder().encode(value).length <= 512 && !/[\u0000-\u001f\u007f]/.test(value));
  async function send(action: "status" | "execute") {
    if (inFlight.current || !draft.connectionId || (action === "execute" && (!status.allowed || !confirmed || !validInputs))) return;
    inFlight.current = true; setBusy(true); setConfirmed(false);
    if (action === "execute") setResult(null);
    const controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => controller.abort(), 125_000);
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(draft.connectionId)}/practice/sqli`, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, draft, ...(action === "execute" ? { confirmed: true } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reason ?? payload.message ?? "서버가 실행을 차단했습니다.");
      if (action === "status") {
        if (payload.allowed !== true || typeof payload.expiresAt !== "string" || Date.parse(payload.expiresAt) <= Date.now()
          || !Number.isFinite(Date.parse(payload.expiresAt)) || !Number.isSafeInteger(payload.remainingRequests) || payload.remainingRequests < 2
          || typeof payload.approvalId !== "string" || typeof payload.targetId !== "string") throw new Error("서버 실행 승인과 요청 예산을 확인하지 못했습니다.");
        setStatus(payload as SqliExecutionStatus);
      } else {
        if (!payload.result || payload.result.assessment?.status !== "INCONCLUSIVE") throw new Error("실제 요청 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다.");
        setResult(payload.result as SqliComparisonResult);
        setStatus({ allowed: false, reason: "실행 예산을 사용했습니다. 추가 실행 전 서버 승인을 다시 확인하세요." });
      }
    } catch (error) {
      setStatus({ allowed: false, reason: controller.signal.aborted ? "서버 응답 대기 시간이 초과되었습니다. 요청이 이미 전송됐을 수 있으므로 자동 재시도하지 않습니다."
        : error instanceof Error ? error.message : "서버 승인 확인 또는 요청이 실패했습니다." });
    } finally { clearTimeout(timer); inFlight.current = false; setBusy(false); }
  }
  return <section aria-label="SQL Injection 요청 편집기">
    <h3>SQL Injection 요청 편집기</h3>
    <p>취약점 후보에 대한 GET · 쿼리 파라미터 1개 요청을 준비합니다. 입력은 이 화면에서만 유지됩니다.</p>
    <dl className="repository-metadata">
      <div><dt>대상 배포 URL</dt><dd><code>{draft.target.deploymentOrigin}</code></dd></div>
      <div><dt>API 경로</dt><dd><code>{draft.target.apiPath}</code></dd></div>
      <div><dt>HTTP 메서드</dt><dd>GET</dd></div>
      <div><dt>입력 위치 / 파라미터</dt><dd>query / <code>{draft.target.parameter}</code></dd></div>
    </dl>
    <div className={styles.grid}>
      <div><label>정상 요청 입력값 <input disabled={busy} value={baseline} maxLength={512} onChange={event => { setBaseline(event.target.value); setConfirmed(false); setResult(null); }} /></label>
        <h4>정상 요청 미리보기 · 전송 안 됨</h4><pre className={styles.preview}>{sqliRequestPreview(draft, "baseline")}</pre></div>
      <div><label>테스트 요청 입력값 <input disabled={busy} value={test} maxLength={512} onChange={event => { setTest(event.target.value); setConfirmed(false); setResult(null); }} /></label>
        <h4>테스트 요청 미리보기 · 전송 안 됨</h4><pre className={styles.preview}>{sqliRequestPreview(draft, "test")}</pre></div>
    </div>
    <button type="button" className="secondary-action" disabled={busy || !draft.connectionId || !validInputs} onClick={() => void send("status")}>서버 실행 승인 확인 · 대상 요청 없음</button>
    <p id="sqli-execution-unavailable" role="status">{status.reason}</p>
    {status.allowed && <p>남은 요청: {status.remainingRequests}회 · 만료: {status.expiresAt} · 정상값과 테스트값을 각각 최대 1회 전송합니다.</p>}
    {!validInputs && <p role="alert">각 입력은 UTF-8 512바이트 이내이며 제어문자를 포함할 수 없습니다.</p>}
    <p>기초 실습 서버는 연결하지 않습니다. 서버가 등록·검토한 테스트 전용 배포 1개만 허용하며, 임의 외부 URL이나 인증 쿠키·GitHub/Vercel 토큰을 대상에 전달하지 않습니다.</p>
    <label><input type="checkbox" disabled={busy || !status.allowed} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> 위 대상과 두 요청 내용을 확인했으며 전송에 동의합니다.</label>
    <button type="button" className="secondary-action" disabled={busy || !status.allowed || !confirmed || !validInputs} aria-describedby="sqli-execution-unavailable" onClick={() => void send("execute")}>{busy ? "서버 검증 / 요청 처리 중…" : status.allowed ? "정상값·테스트값 요청 전송" : "테스트 실행 환경 연결 전"}</button>
    <button type="button" className="secondary-action" disabled={busy} onClick={onBack}>실습 준비로 돌아가기</button>
    <SqliResponseComparison result={result} />
  </section>;
}
