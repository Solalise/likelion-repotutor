"use client";
import { useEffect, useRef } from "react";
import type { AccessControlFinding } from "@/types/security";
import { practiceMethods } from "@/lib/security-lab/practiceTarget";
import { SecurityTargetRecords, useConfirmedPracticeTarget, useSecuritySession } from "./SecurityTestRecord";
import { accessCases, accessDecisionLabels, containsCredentialMaterial, parseAccessPlan, splitRoles, type AccessDecision, type AccessPlan } from "@/lib/security-lab/manualAccess";
export type ManualSecurityKind = "IDOR" | "AUTHORIZATION";
type CommonTarget = { apiPath: string; method: string; purpose: string; expectedBehavior: string };
type IdorDetails = { objectId: string; otherObjectId: string; ownerAccount: string; otherAccount: string; identifierLocation: string };
type AuthorizationDetails = { protectedFeature: string; requiredRole: string; allowedRoles: string; deniedRoles: string };
type ExtraOperation = { id: string; name: string; apiPath: string; method: string; expected: Record<string, AccessDecision> };

/** User-authored aliases and synthetic resource policies. Never sends target HTTP requests. */
export function ManualSecurityTarget({ kind, candidate }: { kind: ManualSecurityKind; candidate?: AccessControlFinding }) {
  const title = kind === "IDOR" ? "IDOR" : "권한 검증", scope = candidate ? `finding:${kind}:${candidate.id}` : `manual:${kind}`;
  const api = candidate?.api?.relation === "confirmed" ? candidate.api : undefined;
  const codeLocation = candidate ? `${candidate.filePath}:${candidate.line}–${candidate.endLine}` : "";
  const [state, setState] = useSecuritySession(`registration:${scope}`, () => ({
    target: { apiPath: api?.path ?? "", method: api?.method ?? (candidate ? "" : "GET"), purpose: candidate?.planSuggestion?.purpose ?? "", expectedBehavior: "" } as CommonTarget,
    idor: { objectId: "", otherObjectId: "", ownerAccount: "", otherAccount: "", identifierLocation: candidate?.planSuggestion?.identifierLocation ?? "" } as IdorDetails,
    authorization: { protectedFeature: candidate ? [api?.method, api?.path, candidate.functionName].filter(Boolean).join(" ") : "", requiredRole: "", allowedRoles: "", deniedRoles: "" } as AuthorizationDetails,
    expected: { A_OWN: "ALLOW", A_OTHER: "DENY", B_OWN: "ALLOW", B_OTHER: "DENY" } as Record<"A_OWN" | "A_OTHER" | "B_OWN" | "B_OTHER", AccessDecision>,
    operations: [] as ExtraOperation[], nextOperation: 1, policyConfirmed: false, prepared: false, recordOpen: false, inputWarning: "",
  }));
  const { target, idor, authorization, prepared, recordOpen } = state;
  const targetState = useConfirmedPracticeTarget(scope), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (prepared) heading.current?.focus(); }, [prepared, recordOpen]);
  const edit = (patch: Partial<typeof state>) => {
    if (containsCredentialMaterial(patch)) { setState(previous => ({ ...previous, inputWarning: "인증정보로 보이는 입력은 등록하지 않았습니다. 테스트 별칭과 합성 ID만 입력하세요." })); return; }
    targetState.invalidate(); setState(previous => ({ ...previous, ...patch, policyConfirmed: false, inputWarning: "" }));
  };
  const setTarget = (patch: Partial<CommonTarget>) => edit({ target: { ...target, ...patch } });
  const setIdor = (patch: Partial<IdorDetails>) => edit({ idor: { ...idor, ...patch } });
  const setAuthorization = (patch: Partial<AuthorizationDetails>) => edit({ authorization: { ...authorization, ...patch } });
  const roles = [...splitRoles(authorization.allowedRoles), ...splitRoles(authorization.deniedRoles)];
  let plan: AccessPlan | null = null;
  try {
    const raw: AccessPlan = kind === "IDOR" ? { version: "manual-access-v1", kind, accounts: [{ alias: idor.ownerAccount, resourceId: idor.objectId }, { alias: idor.otherAccount, resourceId: idor.otherObjectId }], identifierLocation: idor.identifierLocation, expected: state.expected }
      : { version: "manual-access-v1", kind, roles, operations: [{ id: "primary", name: authorization.protectedFeature, apiPath: target.apiPath, method: target.method, expected: Object.fromEntries(roles.map(role => [role, splitRoles(authorization.allowedRoles).includes(role) ? "ALLOW" : "DENY"])) }, ...state.operations.map(op => ({ ...op, expected: Object.fromEntries(roles.map(role => [role, op.expected[role] ?? "UNKNOWN"])) }))] };
    plan = parseAccessPlan(raw, target, kind);
  } catch { /* Incomplete registration is a draft, never an executable target. */ }
  const complete = Boolean(plan && target.purpose.trim() && target.expectedBehavior.trim() && (kind === "IDOR" || authorization.requiredRole.trim()) && state.policyConfirmed);
  const cases = plan ? accessCases(plan, target) : [];
  function editOperation(id: string, patch: Partial<ExtraOperation>) { edit({ operations: state.operations.map(op => op.id === id ? { ...op, ...patch } : op) }); }
  return <section className="tutor-card" aria-label={`${title} 수동 검사 대상`}>
    <h3 ref={heading} tabIndex={-1}>{title} · {recordOpen ? "결과 기록" : prepared ? "수동 검사 준비" : "수동 검사 대상 등록"}</h3>
    <p>모든 정책·소유 관계·역할과 관찰은 사용자 작성이며 서버 미검증입니다. 자동 정적 분석이나 취약점 확정 결과가 아닙니다.</p>
    {candidate?.planSuggestion && <details><summary>코드에서 자동 입력한 정보와 정책 확인</summary>
      <p>식별자 위치: {candidate.planSuggestion.identifierLocation || "미확인"} · 관찰된 역할: {candidate.planSuggestion.observedRoles.join(", ") || "미확인"}</p>
      <p>소유권 검사 {candidate.planSuggestion.ownershipChecks.length}개 · 역할 검사 {candidate.planSuggestion.roleChecks.length}개. 관찰된 검사는 허용 정책의 확정이 아닙니다. 테스트 계정·리소스·기대 접근·필수 역할을 확인하세요.</p>
    </details>}
    {candidate && <p>정적 의심 후보 연결: {candidate.id} · {codeLocation}. 확인된 API와 식별자 정보를 초안으로 전달했습니다. 계정·리소스·역할·배포 커밋과 최종 대상을 직접 확인하세요.</p>}
    {state.inputWarning && <p role="alert">{state.inputWarning}</p>}
    <p>초안은 현재 분석 화면의 탭·준비/기록 이동 중 유지됩니다. DB 저장한 기록만 새로고침 후 결과 페이지에서 조회할 수 있습니다. API·계정·리소스·역할·작업·기대 정책 변경 후 확정하면 새 버전을 만들고 이전 기록은 읽기 전용으로 보존합니다.</p>
    <div hidden={recordOpen}>{prepared ? <>
      <p role="status">미실행 · 사용자 작성 준비 정보 · 자동 요청 없음</p>
      <dl className="repository-metadata">
        <div><dt>검사 유형</dt><dd>{title} (수동 등록)</dd></div><div><dt>검사 대상 API 경로</dt><dd><code>{target.method} {target.apiPath}</code></dd></div>
        <div><dt>검사 목적</dt><dd>{target.purpose}</dd></div><div><dt>기대 동작</dt><dd>{target.expectedBehavior}</dd></div>
        {kind === "IDOR" ? <><div><dt>계정 A / 소유 리소스</dt><dd>{idor.ownerAccount} / {idor.objectId}</dd></div><div><dt>계정 B / 소유 리소스</dt><dd>{idor.otherAccount} / {idor.otherObjectId}</dd></div></> : <><div><dt>보호 대상 기능 / 필요한 역할</dt><dd>{authorization.protectedFeature} / {authorization.requiredRole}</dd></div><div><dt>등록 역할</dt><dd>{roles.join(", ")}</dd></div></>}
      </dl>
      <ul>{cases.map(row => <li key={row.id}>{row.actor} · {row.resource} · {row.operation} · {row.method} {row.apiPath} → 기대: {accessDecisionLabels[row.expected]}</li>)}</ul>
      <p>계정은 별칭만 등록했습니다. 실제 계정 인증·소유 관계·역할 조건·실행 권한은 서버에서 확인하지 않습니다. 승인된 격리 환경에서 직접 얻은 결과만 기록하세요.</p>
      <button className="secondary-action" type="button" onClick={() => setState(p => ({ ...p, prepared: false }))}>수정 화면으로 돌아가기</button>
      <button className="secondary-action" type="button" onClick={() => setState(p => ({ ...p, recordOpen: true }))}>검사 결과 기록으로 이동</button>
      <button className="secondary-action" type="button" disabled>실제 요청 실행 · 미지원</button>
    </> : <form onSubmit={event => { event.preventDefault(); if (complete && plan) {
      targetState.confirm({ apiPath: target.apiPath, method: target.method, inputLocation: "manual", parameter: kind === "IDOR" ? idor.identifierLocation : "role/operation", details: {
        "검사 목적": target.purpose, "기대 동작": target.expectedBehavior, accessPlan: JSON.stringify(plan),
        ...(candidate ? { "정적 후보 ID": candidate.id, "정적 코드 위치": codeLocation, "정적 분석 출처": "STATIC_REVIEW_ONLY · 실행 미검증" } : {}),
        ...(kind === "IDOR" ? { "객체 식별자 A": idor.objectId, "객체 식별자 B": idor.otherObjectId, "소유 계정 A": idor.ownerAccount, "소유 계정 B": idor.otherAccount }
          : { "보호 기능": authorization.protectedFeature, "필요 역할": authorization.requiredRole, "허용 역할": authorization.allowedRoles, "거부 역할": authorization.deniedRoles }) } });
      setState(p => ({ ...p, prepared: true }));
    } }}>
      <p>테스트 계정·역할은 별칭만 입력하세요. 비밀번호·세션 쿠키·토큰은 입력하거나 저장할 수 없습니다. 리소스 ID는 합성 영문·숫자·하이픈·밑줄 1~80자만 사용합니다.</p>
      <label>검사 대상 API 경로<input required maxLength={256} value={target.apiPath} placeholder="/api/…" onChange={event => setTarget({ apiPath: event.target.value })} /></label>
      <label>HTTP 메서드<select required value={target.method} onChange={event => setTarget({ method: event.target.value })}>{candidate && <option value="">직접 선택</option>}{practiceMethods.map(method => <option key={method}>{method}</option>)}</select></label>
      <label>검사 목적<input required maxLength={1000} value={target.purpose} onChange={event => setTarget({ purpose: event.target.value })} /></label>
      <label>기대 동작<input required maxLength={1000} value={target.expectedBehavior} onChange={event => setTarget({ expectedBehavior: event.target.value })} /></label>
      {kind === "IDOR" ? <fieldset><legend>계정 A/B와 각 소유 리소스 (사용자 선언)</legend>
        <label>객체 식별자 A<input required maxLength={80} value={idor.objectId} onChange={event => setIdor({ objectId: event.target.value })} /></label>
        <label>계정 B 소유 리소스 식별자<input required maxLength={80} value={idor.otherObjectId} onChange={event => setIdor({ otherObjectId: event.target.value })} /></label>
        <label>테스트 계정 A · 객체 소유 계정<input required maxLength={80} value={idor.ownerAccount} onChange={event => setIdor({ ownerAccount: event.target.value })} /></label>
        <label>테스트 계정 B · 다른 계정<input required maxLength={80} value={idor.otherAccount} onChange={event => setIdor({ otherAccount: event.target.value })} /></label>
        <label>리소스 식별자 위치<input required maxLength={120} placeholder="예: path의 [id] 또는 query의 orderId" value={idor.identifierLocation} onChange={event => setIdor({ identifierLocation: event.target.value })} /></label>
        {Object.entries(state.expected).map(([id, value]) => <label key={id}>{({ A_OWN: "A → A 소유 리소스", A_OTHER: "A → B 소유 리소스", B_OWN: "B → B 소유 리소스", B_OTHER: "B → A 소유 리소스" })[id]} 기대 접근<select aria-label={`${id} 기대 접근`} value={value} onChange={event => edit({ expected: { ...state.expected, [id]: event.target.value as AccessDecision } })}>{Object.entries(accessDecisionLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
      </fieldset> : <fieldset><legend>역할별 API·작업 정책 (역할 2~4개, 작업 1~4개)</legend>
        <label>보호 대상 기능<input required maxLength={80} value={authorization.protectedFeature} onChange={event => setAuthorization({ protectedFeature: event.target.value })} /></label>
        <label>필요한 역할<input required maxLength={80} value={authorization.requiredRole} onChange={event => setAuthorization({ requiredRole: event.target.value })} /></label>
        <label>허용되어야 하는 역할<input required maxLength={320} value={authorization.allowedRoles} onChange={event => setAuthorization({ allowedRoles: event.target.value })} /></label>
        <label>거부되어야 하는 역할<input required maxLength={320} value={authorization.deniedRoles} onChange={event => setAuthorization({ deniedRoles: event.target.value })} /></label>
        <p>역할은 쉼표로 구분하고 중복·허용/거부 중첩 없이 등록하세요. 첫 작업은 위 API와 보호 기능을 사용합니다.</p>
        {state.operations.map(op => <fieldset key={op.id}><legend>추가 작업</legend>
          <label>작업 이름<input value={op.name} maxLength={80} onChange={event => editOperation(op.id, { name: event.target.value })} /></label>
          <label>작업 API 경로<input value={op.apiPath} maxLength={256} onChange={event => editOperation(op.id, { apiPath: event.target.value })} /></label>
          <label>작업 HTTP 메서드<select value={op.method} onChange={event => editOperation(op.id, { method: event.target.value })}>{practiceMethods.map(method => <option key={method}>{method}</option>)}</select></label>
          {[...new Set(roles)].map(role => <label key={role}>{role} 기대 접근<select value={op.expected[role] ?? "UNKNOWN"} onChange={event => editOperation(op.id, { expected: { ...op.expected, [role]: event.target.value as AccessDecision } })}>{Object.entries(accessDecisionLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
          <button type="button" onClick={() => edit({ operations: state.operations.filter(row => row.id !== op.id) })}>추가 작업 제거</button>
        </fieldset>)}
        <button type="button" disabled={state.operations.length >= 3} onClick={() => edit({ operations: [...state.operations, { id: `operation-${state.nextOperation}`, name: "", apiPath: "", method: "GET", expected: {} }], nextOperation: state.nextOperation + 1 })}>역할별 API·작업 추가</button>
      </fieldset>}
      {!plan && <p role="status">상대 API 경로·서로 다른 테스트 계정/리소스·역할 및 작업 정책을 확인하세요. 인증정보는 받지 않습니다.</p>}
      <label><input type="checkbox" checked={state.policyConfirmed} onChange={event => setState(p => ({ ...p, policyConfirmed: event.target.checked }))} /> 위 테스트 별칭·소유 관계·역할 및 기대 접근 정책을 직접 확인했습니다 (실행 승인 아님).</label>
      <button className="secondary-action" type="submit" disabled={!complete}>준비 화면으로 이동</button>
    </form>}</div>
    <div hidden={!recordOpen}><SecurityTargetRecords scope={scope} kind={kind} codeLocation={codeLocation} history={targetState.history} onBack={() => setState(p => ({ ...p, recordOpen: false }))} /></div>
  </section>;
}
