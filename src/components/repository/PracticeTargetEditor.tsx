"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RepositoryAnalysis } from "@/types/analysis";
import { practiceMethods, practiceTarget, targetUrl, type PracticeFinding } from "@/lib/security-lab/practiceTarget";
import { SqliRequestEditor } from "./SqliRequestEditor";
import { sqliTargetKey, type SqliEditorSession, type SqliRequestDraft } from "@/lib/security-lab/sqliTypes";
import { useConfirmedPracticeTarget, useSecuritySession } from "./SecurityTestRecord";
import { practiceRecordKey, practiceTargetIdentity } from "@/types/securityPracticeTarget";
import { safeSqliProbe } from "@/lib/security-lab/sqliProbe";
import { XssRequestEditor } from "./XssRequestEditor";
import { safeXssProbe } from "@/lib/security-lab/xssProbe";
import { xssTargetKey, type XssRequestDraft, type XssEditorSession } from "@/lib/security-lab/xssTypes";

export function PracticeTargetEditor({ analysis, finding, baseUrl, ownership, connectionId, targetReady = true }: {
  analysis: RepositoryAnalysis; finding: PracticeFinding; baseUrl?: string | null; ownership: boolean; connectionId?: string; targetReady?: boolean;
}) {
  const suggestion = practiceTarget(analysis, finding);
  const scope = `finding:${finding.type}:${finding.id}`;
  const targetState = useConfirmedPracticeTarget(scope);
  const invalidateTarget = targetState.invalidate;
  const [state, setState] = useSecuritySession(`preparation:${scope}:${JSON.stringify([connectionId, analysis.repository, analysis.collection?.commitSha, baseUrl])}`, () => ({
    path: suggestion.path, method: suggestion.method, location: "", parameter: "", value: finding.type === "XSS" ? safeXssProbe.baseline : "", confirmed: false,
    reflectionLocation: "", reflectionContext: "UNKNOWN" as "HTML_TEXT" | "HTML_ATTRIBUTE" | "UNKNOWN",
    screen: false, editor: false, sqliSession: null as SqliEditorSession | null, xssSession: null as XssEditorSession | null,
  }));
  const { path, method, location, parameter, value, confirmed, screen, editor, sqliSession } = state;
  const setField = <K extends keyof typeof state>(field: K, value: typeof state[K]) => setState(previous => ({ ...previous, [field]: value }));
  const editTarget = (field: "path" | "method" | "location" | "parameter" | "reflectionLocation" | "reflectionContext", value: string) => {
    targetState.invalidate(); setState(previous => ({ ...previous, [field]: value, confirmed: false, sqliSession: null, xssSession: null }));
  };
  const setSqliSession = useCallback((session: SqliEditorSession | null) => setState(previous => ({ ...previous, sqliSession: session })), [setState]);
  const setXssSession = useCallback((session: XssEditorSession) => setState(previous => ({ ...previous, xssSession: session })), [setState]);
  const preparationRef = useRef<HTMLElement>(null);
  useEffect(() => { if (screen) preparationRef.current?.focus(); }, [screen, editor]);
  const url = targetUrl(baseUrl, path);
  const complete = Boolean(url && practiceMethods.includes(method as typeof practiceMethods[number]) && location && parameter.trim() && confirmed && (finding.type !== "XSS" || state.reflectionLocation.trim()));
  const manual = path !== suggestion.path || method !== suggestion.method || suggestion.status === "MANUAL_REQUIRED";
  const editorSupported = method === "GET" && location === "query";
  const requestDraft: SqliRequestDraft | null = url && editorSupported && finding.type === "SQL_INJECTION" ? {
    version: "sqli-practice-v1", connectionId: connectionId ?? null,
    repository: analysis.repository, commitSha: analysis.collection?.commitSha ?? null, findingId: finding.id,
    target: { deploymentOrigin: new URL(url).origin, apiPath: path, method: "GET", inputLocation: "query", parameter: parameter.trim() },
    baseline: { value }, test: { value: safeSqliProbe.value },
  } : null;
  const xssDraft: XssRequestDraft | null = url && editorSupported && finding.type === "XSS" ? {
    version: "xss-practice-v1", connectionId: connectionId ?? null, repository: analysis.repository, commitSha: analysis.collection?.commitSha ?? null, findingId: finding.id,
    target: { deploymentOrigin: new URL(url).origin, apiPath: path, method: "GET", inputLocation: "query", parameter: parameter.trim(), reflectionLocation: state.reflectionLocation.trim(), reflectionContext: state.reflectionContext },
    baseline: { value: safeXssProbe.baseline }, test: { value: safeXssProbe.value },
  } : null;
  const confirmedTarget = { apiPath: path, method, inputLocation: location, parameter: parameter.trim(), deploymentUrl: baseUrl ?? undefined,
    ...(finding.type === "XSS" ? { details: { "반영 위치": state.reflectionLocation.trim(), "예상 HTML 문맥": state.reflectionContext } } : {}) };
  const activeTarget = targetState.history.versions.find(item => item.id === targetState.history.activeId)?.target;
  const targetMatches = Boolean(activeTarget && practiceTargetIdentity(activeTarget) === practiceTargetIdentity(confirmedTarget));
  useEffect(() => { if (targetReady && activeTarget && !targetMatches) invalidateTarget(); }, [targetReady, targetMatches, activeTarget, invalidateTarget]);
  if (screen && complete && targetMatches && editor && xssDraft) return <section ref={preparationRef} tabIndex={-1} aria-label="XSS 요청 편집 화면">
    <XssRequestEditor key={xssTargetKey(xssDraft)} initialDraft={xssDraft} session={state.xssSession} onSessionChange={setXssSession} onBack={() => setField("editor", false)}
      recordContext={targetState.history.activeId === null ? undefined : { recordKey: practiceRecordKey(scope, targetState.history.activeId), confirmedTarget, codeLocation: `${finding.filePath}:${finding.line}–${finding.endLine}` }} />
  </section>;
  if (screen && complete && targetMatches && editor && requestDraft) return <section ref={preparationRef} tabIndex={-1} aria-label="SQLi 요청 편집 화면">
    <SqliRequestEditor key={sqliTargetKey(requestDraft)} initialDraft={requestDraft}
      recordContext={targetState.history.activeId === null ? undefined : {
        recordKey: practiceRecordKey(scope, targetState.history.activeId), confirmedTarget,
        codeLocation: `${finding.filePath}:${finding.line}–${finding.endLine}`,
      }}
      session={sqliSession} onSessionChange={setSqliSession} onBack={() => setField("editor", false)} />
  </section>;
  if (screen && complete && targetMatches) return <section ref={preparationRef} aria-label="실습 준비 화면" tabIndex={-1}>
    <h3>실습 준비 · 취약점 후보</h3>
    <dl className="repository-metadata">
      <div><dt>대상 URL</dt><dd><code>{url}</code></dd></div>
      <div><dt>유형 / 메서드</dt><dd>{finding.type} / {method}</dd></div>
      <div><dt>입력 위치 / 파라미터</dt><dd>{location} / {parameter}</dd></div>
      <div><dt>기준 입력값</dt><dd><pre>{value || "(빈 값)"}</pre></dd></div>
      <div><dt>코드 위치</dt><dd>{finding.filePath}:{finding.line}–{finding.endLine}</dd></div>
      <div><dt>연결 상태</dt><dd>{manual ? "사용자 지정 대상 · 코드 연결 미검증" : "정적 API 연결 · 사용자 확인 완료"}</dd></div>
      <div><dt>소유권</dt><dd>{ownership ? "확인 기록 있음" : "미확인"}</dd></div>
      <div><dt>격리 환경 승인</dt><dd>{finding.type === "XSS" ? "XSS" : "SQLi"} 편집기에서 별도 서버 승인 조회 필요</dd></div>
      {finding.type === "XSS" && <div><dt>반영 위치 / 예상 HTML 문맥</dt><dd>{state.reflectionLocation} / {state.reflectionContext} · 실제 반영 위치 일치는 사용자 검토 필요</dd></div>}
      <div><dt>실행 상태</dt><dd>서버 승인 조회 전 기본 차단</dd></div>
    </dl>
    <p>소유권 확인과 입력 확인은 공격 테스트 승인이 아닙니다. 별도로 승인된 격리 환경과 서버의 대상·요청 제한 정책이 연결되어야 실행할 수 있습니다.</p>
    <button type="button" className="secondary-action" onClick={() => setField("screen", false)}>대상 수정으로 돌아가기</button>
    {editorSupported ? <button type="button" className="secondary-action" onClick={() => setField("editor", true)}>{finding.type === "XSS" ? "XSS" : "SQLi"} 요청 편집기로 이동</button>
      : <p>자동 관찰은 GET · query 입력만 지원합니다. 다른 메서드·입력 경로는 수동 기록을 사용하세요.</p>}
  </section>;
  return <section aria-label="실습 대상 API 확인">
    <h3>실습 대상 API 및 입력값 확인</h3>
    <p>{suggestion.reason}</p>
    {suggestion.path && <p>정적 경로: <code>{suggestion.method} {suggestion.path}</code></p>}
    <p>동적 경로의 [id] 등은 실제 값으로 바꾸세요. 입력 위치·파라미터·기준값은 추측하지 않습니다. 값은 이 화면에서만 유지되며 새로고침하면 초기화됩니다.</p>
    <form onSubmit={event => { event.preventDefault(); if (complete && targetReady) { targetState.confirm(confirmedTarget); setField("screen", true); } }} onChange={() => setField("confirmed", false)}>
      <p><label>API 경로 <input required value={path} onChange={event => editTarget("path", event.target.value)} placeholder="/api/…" /></label></p>
      <p><label>HTTP 메서드 <select required value={method} onChange={event => editTarget("method", event.target.value)}><option value="">직접 선택</option>{practiceMethods.map(item => <option key={item}>{item}</option>)}</select></label></p>
      <p><label>입력 위치 <select required value={location} onChange={event => editTarget("location", event.target.value)}><option value="">직접 선택</option>{["query", "JSON body", "form body", "path", "header", "cookie"].map(item => <option key={item}>{item}</option>)}</select></label></p>
      <p><label>테스트 파라미터 <input required value={parameter} onChange={event => editTarget("parameter", event.target.value)} /></label></p>
      <p><label>기준 입력값 (요청 전송 없음) <input readOnly={finding.type === "XSS"} value={value} onChange={event => setField("value", event.target.value)} /></label></p>
      {finding.type === "XSS" && <>
        <p><label>반영 위치 (화면 영역·요소·코드 위치)<input required maxLength={500} value={state.reflectionLocation} onChange={event => editTarget("reflectionLocation", event.target.value)} /></label></p>
        <p><label>예상 HTML 문맥<select value={state.reflectionContext} onChange={event => editTarget("reflectionContext", event.target.value)}><option value="UNKNOWN">미확정 · 안전성 판정 제한</option><option value="HTML_TEXT">HTML 텍스트</option><option value="HTML_ATTRIBUTE">HTML 속성</option></select></label></p>
      </>}
      <p>{!baseUrl ? "배포 URL을 먼저 연결하고 연결 상태를 새로고침하세요." : !url ? "같은 배포 주소의 절대 경로를 입력하세요. 동적 자리표시자·쿼리·fragment는 사용할 수 없습니다." : `대상 URL: ${url}`}</p>
      <p>{manual ? "사용자 지정 대상 · 정적 후보와의 연결은 직접 검토해야 합니다." : "AST 경로·메서드 제안 · 실제 배포 경로를 확인하세요."}</p>
      <p><label><input type="checkbox" checked={confirmed} onChange={event => { event.stopPropagation(); setField("confirmed", event.target.checked); }} /> 위 API·메서드·입력값을 확인했습니다 (실행 승인 아님).</label></p>
      <button className="secondary-action" type="submit" disabled={!complete}>실습 준비 화면으로 이동</button>
    </form>
  </section>;
}
