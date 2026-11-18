"use client";

import { useEffect, useRef, useState } from "react";
import type { RepositoryAnalysis } from "@/types/analysis";
import { practiceMethods, practiceTarget, targetUrl, type PracticeFinding } from "@/lib/security-lab/practiceTarget";
import { SqliRequestEditor } from "./SqliRequestEditor";

export function PracticeTargetEditor({ analysis, finding, baseUrl, ownership, connectionId }: {
  analysis: RepositoryAnalysis; finding: PracticeFinding; baseUrl?: string | null; ownership: boolean; connectionId?: string;
}) {
  const suggestion = practiceTarget(analysis, finding);
  const [path, setPath] = useState(suggestion.path);
  const [method, setMethod] = useState(suggestion.method);
  const [location, setLocation] = useState("");
  const [parameter, setParameter] = useState("");
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [screen, setScreen] = useState(false);
  const [editor, setEditor] = useState(false);
  const preparationRef = useRef<HTMLElement>(null);
  useEffect(() => { if (screen) preparationRef.current?.focus(); }, [screen, editor]);
  const url = targetUrl(baseUrl, path);
  const complete = Boolean(url && practiceMethods.includes(method as typeof practiceMethods[number]) && location && parameter.trim() && confirmed);
  const manual = path !== suggestion.path || method !== suggestion.method || suggestion.status === "MANUAL_REQUIRED";
  const editorSupported = finding.type === "SQL_INJECTION" && method === "GET" && location === "query";
  if (screen && complete && editor && editorSupported) return <section ref={preparationRef} tabIndex={-1} aria-label="SQLi 요청 편집 화면">
    <SqliRequestEditor initialDraft={{ version: "sqli-practice-v1", connectionId: connectionId ?? null,
      repository: analysis.repository, commitSha: analysis.collection?.commitSha ?? null, findingId: finding.id,
      target: { deploymentOrigin: new URL(url!).origin, apiPath: path, method: "GET", inputLocation: "query", parameter: parameter.trim() },
      baseline: { value }, test: { value: "" } }} onBack={() => setEditor(false)} />
  </section>;
  if (screen && complete) return <section ref={preparationRef} aria-label="실습 준비 화면" tabIndex={-1}>
    <h3>실습 준비 · 취약점 후보</h3>
    <dl className="repository-metadata">
      <div><dt>대상 URL</dt><dd><code>{url}</code></dd></div>
      <div><dt>유형 / 메서드</dt><dd>{finding.type} / {method}</dd></div>
      <div><dt>입력 위치 / 파라미터</dt><dd>{location} / {parameter}</dd></div>
      <div><dt>기준 입력값</dt><dd><pre>{value || "(빈 값)"}</pre></dd></div>
      <div><dt>코드 위치</dt><dd>{finding.filePath}:{finding.line}–{finding.endLine}</dd></div>
      <div><dt>연결 상태</dt><dd>{manual ? "사용자 지정 대상 · 코드 연결 미검증" : "정적 API 연결 · 사용자 확인 완료"}</dd></div>
      <div><dt>소유권</dt><dd>{ownership ? "확인 기록 있음" : "미확인"}</dd></div>
      <div><dt>격리 환경 승인</dt><dd>SQLi 편집기에서 별도 서버 승인 조회 필요</dd></div>
      <div><dt>실행 상태</dt><dd>서버 승인 조회 전 기본 차단</dd></div>
    </dl>
    <p>소유권 확인과 입력 확인은 공격 테스트 승인이 아닙니다. 별도로 승인된 격리 환경과 서버의 대상·요청 제한 정책이 연결되어야 실행할 수 있습니다.</p>
    <button type="button" className="secondary-action" onClick={() => setScreen(false)}>대상 수정으로 돌아가기</button>
    {editorSupported ? <button type="button" className="secondary-action" onClick={() => setEditor(true)}>SQLi 요청 편집기로 이동</button>
      : <p>{finding.type === "XSS" ? "XSS 실행은 아직 지원하지 않습니다." : "SQLi MVP는 GET · query 입력만 지원합니다. 대상 수정에서 변경하세요."}</p>}
  </section>;
  return <section aria-label="실습 대상 API 확인">
    <h3>실습 대상 API 및 입력값 확인</h3>
    <p>{suggestion.reason}</p>
    {suggestion.path && <p>정적 경로: <code>{suggestion.method} {suggestion.path}</code></p>}
    <p>동적 경로의 [id] 등은 실제 값으로 바꾸세요. 입력 위치·파라미터·기준값은 추측하지 않습니다. 값은 이 화면에서만 유지되며 새로고침하면 초기화됩니다.</p>
    <form onSubmit={event => { event.preventDefault(); if (complete) setScreen(true); }} onChange={() => setConfirmed(false)}>
      <p><label>API 경로 <input required value={path} onChange={event => setPath(event.target.value)} placeholder="/api/…" /></label></p>
      <p><label>HTTP 메서드 <select required value={method} onChange={event => setMethod(event.target.value)}><option value="">직접 선택</option>{practiceMethods.map(item => <option key={item}>{item}</option>)}</select></label></p>
      <p><label>입력 위치 <select required value={location} onChange={event => setLocation(event.target.value)}><option value="">직접 선택</option>{["query", "JSON body", "form body", "path", "header", "cookie"].map(item => <option key={item}>{item}</option>)}</select></label></p>
      <p><label>테스트 파라미터 <input required value={parameter} onChange={event => setParameter(event.target.value)} /></label></p>
      <p><label>기준 입력값 (요청 전송 없음) <input value={value} onChange={event => setValue(event.target.value)} /></label></p>
      <p>{!baseUrl ? "배포 URL을 먼저 연결하고 연결 상태를 새로고침하세요." : !url ? "같은 배포 주소의 절대 경로를 입력하세요. 동적 자리표시자·쿼리·fragment는 사용할 수 없습니다." : `대상 URL: ${url}`}</p>
      <p>{manual ? "사용자 지정 대상 · 정적 후보와의 연결은 직접 검토해야 합니다." : "AST 경로·메서드 제안 · 실제 배포 경로를 확인하세요."}</p>
      <p><label><input type="checkbox" checked={confirmed} onChange={event => { event.stopPropagation(); setConfirmed(event.target.checked); }} /> 위 API·메서드·입력값을 확인했습니다 (실행 승인 아님).</label></p>
      <button className="secondary-action" type="submit" disabled={!complete}>실습 준비 화면으로 이동</button>
    </form>
  </section>;
}
