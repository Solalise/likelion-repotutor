"use client";

import { createContext, useCallback, useContext, useState, type ReactNode, type SetStateAction } from "react";
import { confirmPracticeTarget, emptyTargetHistory, practiceRecordKey, type ConfirmedPracticeTarget, type PracticeTargetHistory } from "@/types/securityPracticeTarget";
import { practiceMethods } from "@/lib/security-lab/practiceTarget";
import { sqliDisplayAssessment, type SqliComparisonResult } from "@/lib/security-lab/sqliTypes";
import { validateManualRetest, localDateTimeValue, emptySecurityRecord, manualStatusLabels, retestRecordLabels, securityRecordLabels,
  type SecurityRecordDraft, type SecurityRecordKind } from "@/types/securityTestRecord";
import { RecordPersistence } from "@/components/results/RecordPersistence";
import styles from "./securityTestRecord.module.css";
import { useValidationClock } from "./useValidationClock";
import { AccessComparison } from "./AccessComparison";
import { accessPlanFromTarget, accessRoundComplete, accessChronologyValid, containsCredentialMaterial } from "@/lib/security-lab/manualAccess";

type Initial = Partial<Pick<SecurityRecordDraft, "apiPath" | "method" | "codeLocation" | "targetSnapshot">>;
type Store = { archived?: boolean; persistence?: { repositoryFullName: string; commitSha: string }; drafts: Record<string, SecurityRecordDraft>; update: (id: string, initial: Initial, edit: (previous: SecurityRecordDraft) => SecurityRecordDraft) => void;
  sessions: Record<string, unknown>; setSession: (id: string, edit: (previous: unknown) => unknown) => void };
const RecordContext = createContext<Store | null>(null);

/** Shared, analysis-scoped UI state; local fallback supports standalone preparation screens. */
export function useSecuritySession<T>(id: string, initial: () => T): [T, (action: SetStateAction<T>) => void] {
  const store = useContext(RecordContext);
  const [local, setLocal] = useState(initial);
  const setSession = store?.setSession;
  const update = useCallback((action: SetStateAction<T>) => {
    if (store?.archived) return;
    if (!setSession) return setLocal(action);
    setSession(id, previous => typeof action === "function"
      ? (action as (value: T) => T)((previous as T | undefined) ?? local) : action);
  }, [setSession, id, local, store?.archived]);
  return [store ? (store.sessions[id] as T | undefined) ?? local : local, update];
}

export function useConfirmedPracticeTarget(scope: string) {
  const [history, update] = useSecuritySession<PracticeTargetHistory>(`target:${scope}`, () => emptyTargetHistory);
  const invalidate = useCallback(() => update(previous => previous.activeId === null ? previous : { ...previous, activeId: null }), [update]);
  return { history,
    confirm: (target: ConfirmedPracticeTarget) => update(previous => confirmPracticeTarget(previous, target)),
    invalidate,
  };
}

/** Analysis-scoped drafts. Explicit persistence is provided separately. */
export function SecurityTestRecordProvider({ children, archived = false, persistence }: { children: ReactNode; archived?: boolean; persistence?: Store["persistence"] }) {
  const { now } = useValidationClock();
  const [drafts, setDrafts] = useState<Record<string, SecurityRecordDraft>>({});
  const [sessions, setSessions] = useState<Record<string, unknown>>({});
  const setSession = useCallback((id: string, edit: (previous: unknown) => unknown) => setSessions(previous => {
    const next = edit(previous[id]); return Object.is(next, previous[id]) ? previous : { ...previous, [id]: next };
  }), []);
  return <RecordContext.Provider value={{ archived, persistence, drafts, sessions, setSession, update: (id, initial, edit) => { if (!archived) setDrafts(previous => ({ ...previous, [id]: edit(previous[id] ?? emptySecurityRecord(initial)) })); } }}>{children}
    {archived && <section aria-label="이전 분석의 수동 검사 기록 전체">
      <h3>이전 분석에 작성한 수동 기록</h3>
      <p>사용자 수동 기록 · 서버 미검증. 현재 분석 결과로 이전하지 않습니다.</p>
      {Object.entries(drafts).map(([id, draft]) => <article key={id}>
        <h4>{id} · {draft.method} {draft.apiPath || "대상 미입력"}</h4>
        <p>사용자 선택 상태: {manualStatusLabels[draft.status]} · 재검증: {retestRecordLabels[validateManualRetest(draft, now).retestStatus]}</p>
        <dl className="repository-metadata">{Object.entries({
          "배포 URL": draft.targetSnapshot?.deploymentUrl ?? "", "입력 위치": draft.targetSnapshot?.inputLocation ?? "",
          "파라미터": draft.targetSnapshot?.parameter ?? "", ...draft.targetSnapshot?.details,
          "최초 검사 방법": draft.inspectionMethod, "수정 전 관찰": draft.beforeObservation, "관련 코드": draft.codeLocation,
          "사용자 메모": draft.memo, "수정 파일": draft.changedFiles, "수정 내용": draft.changes,
          "재검증 수행 진술": draft.performedManually ? "수행함 (사용자 진술)" : "미수행", "수행 일시": draft.performedAt,
          "재검증 방법": draft.retestMethod, "수정 후 관찰": draft.afterObservation, "수정 후 사용자 상태": manualStatusLabels[draft.afterStatus],
        }).filter(([label]) => label !== "accessPlan").map(([label, value]) => <div key={label}><dt>{label}</dt><dd><pre>{value || "미입력"}</pre></dd></div>)}</dl>
        <ArchivedAccessComparison draft={draft} recordKey={id} persistence={persistence} now={now} />
      </article>)}
      {!Object.keys(drafts).length && <p>작성한 수동 검사 기록이 없습니다.</p>}
    </section>}
  </RecordContext.Provider>;
}

function ArchivedAccessComparison({ draft, recordKey, persistence, now }: { draft: SecurityRecordDraft; recordKey: string; persistence?: Store["persistence"]; now: number }) {
  if (!draft.accessComparison || !draft.targetSnapshot?.details?.accessPlan) return null;
  let plan: ReturnType<typeof accessPlanFromTarget> = null;
  let invalid = false;
  try {
    const kind = (JSON.parse(draft.targetSnapshot.details.accessPlan) as { kind?: string }).kind;
    plan = accessPlanFromTarget(draft.targetSnapshot, kind ?? "");
  } catch { invalid = true; }
  if (invalid) return <p>이전 접근 비교 정책은 읽기 전용으로 보존되어 있으나 표시 형식을 확인하지 못했습니다.</p>;
  return plan ? <AccessComparison target={draft.targetSnapshot} plan={plan} value={draft.accessComparison} binding={persistence ? { ...persistence, recordKey } : undefined} now={now} readOnly /> : null;
}

type Props = { source: "MANUAL"; recordKey: string; kind: SecurityRecordKind; initial?: Initial; initialDraft?: SecurityRecordDraft; onDraftChange?: (draft: SecurityRecordDraft) => void; onBack?: () => void; confirmedTarget?: ConfirmedPracticeTarget; observations?: { initial: string; latest?: string }; readOnly?: boolean; recordContext?: { repositoryFullName: string; commitSha: string } }
  | { source: "SERVER"; result: SqliComparisonResult };

export function SecurityTestRecord(props: Props) {
  return props.source === "SERVER" ? <ServerRecord result={props.result} /> : <ManualRecord {...props} />;
}

export function SecurityTargetRecords({ scope, kind, codeLocation = "", suggestion, history: supplied, onBack }: {
  scope: string; kind: SecurityRecordKind; codeLocation?: string; suggestion?: { path: string; method: string };
  history?: PracticeTargetHistory; onBack?: () => void;
}) {
  const { history: stored } = useConfirmedPracticeTarget(scope);
  const history = supplied ?? stored;
  return <section aria-label="확정 대상별 검사 기록">
    {history.activeId === null && <p role="status">검사 대상 미확정. 대상 설정에서 확인을 완료해야 현재 대상의 결과를 기록할 수 있습니다.</p>}
    {suggestion?.path && <p>AST 제안 (사용자 확정 아님): {suggestion.method} {suggestion.path}</p>}
    {[...history.versions].reverse().map(version => <details key={version.id} open={version.id === history.activeId}>
      <summary>{version.id === history.activeId ? "현재 확정 대상" : "이전 대상 기록 · 읽기 전용"} #{version.id} · {version.target.method} {version.target.apiPath}</summary>
      <fieldset disabled={version.id !== history.activeId} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SecurityTestRecord key={practiceRecordKey(scope, version.id)} source="MANUAL" kind={kind}
          recordKey={practiceRecordKey(scope, version.id)} confirmedTarget={version.target} readOnly={version.id !== history.activeId}
          initial={{ apiPath: version.target.apiPath, method: version.target.method, codeLocation }} />
      </fieldset>
    </details>)}
    {onBack && <button type="button" className="secondary-action" onClick={onBack}>실습 준비로 돌아가기</button>}
  </section>;
}

function ServerRecord({ result }: { result: SqliComparisonResult }) {
  return <section className="tutor-card" aria-label="서버 HTTP 관찰 출처">
    <h4>검사 결과 출처 · 서버 HTTP 관찰</h4>
    <p>SQLi 실행 API에서 받은 HTTP 관찰 결과입니다. 수동 기록으로 변환하거나 편집하지 않습니다. 취약점 확정 결과가 아닙니다.</p>
    <dl className="repository-metadata">
      <div><dt>유형</dt><dd>SQL Injection</dd></div>
      <div><dt>검사 대상</dt><dd>{result.request.target.method} {result.request.target.deploymentOrigin}{result.request.target.apiPath}</dd></div>
      <div><dt>실행 ID</dt><dd>{result.runId}</dd></div>
      <div><dt>정상 요청 근거</dt><dd>{result.baseline ? `${result.baseline.requestId} · ${result.baseline.outcome} · HTTP ${result.baseline.statusCode ?? "응답 없음"}` : "없음"}</dd></div>
      <div><dt>테스트 요청 근거</dt><dd>{result.test ? `${result.test.requestId} · ${result.test.outcome} · HTTP ${result.test.statusCode ?? "응답 없음"}` : "없음"}</dd></div>
      <div><dt>시스템 판정</dt><dd>{sqliDisplayAssessment(result).reason}</dd></div>
    </dl>
    <p>아래/다른 화면의 사용자 메모는 별도 수동 기록입니다. 서버 응답 본문과 실행 근거는 기존 비교 화면에서 확인하세요.</p>
  </section>;
}

function ManualRecord({ recordKey, kind, initial = {}, initialDraft, onDraftChange, onBack, confirmedTarget, observations, readOnly: suppliedReadOnly = false, recordContext }: Extract<Props, { source: "MANUAL" }>) {
  const { now, refresh } = useValidationClock();
  const store = useContext(RecordContext);
  const recordInitial = { ...initial, targetSnapshot: confirmedTarget ?? initial.targetSnapshot };
  const [local, setLocal] = useState(() => initialDraft ?? emptySecurityRecord(recordInitial));
  const [inputWarning, setInputWarning] = useState("");
  const draft = store ? store.drafts[recordKey] ?? emptySecurityRecord(recordInitial) : initialDraft ?? local;
  let accessPlan = null; let invalidPlan = false;
  try { accessPlan = accessPlanFromTarget(draft.targetSnapshot, kind); } catch { invalidPlan = true; }
  const readOnly = suppliedReadOnly || Boolean(store?.archived) || invalidPlan;
  const update = (edit: (previous: SecurityRecordDraft) => SecurityRecordDraft) => { if (readOnly) return; if (store) store.update(recordKey, recordInitial, edit); else if (onDraftChange) onDraftChange(edit(draft)); else setLocal(edit); };
  const patch = (changes: Partial<SecurityRecordDraft>) => {
    if ((kind === "IDOR" || kind === "AUTHORIZATION") && containsCredentialMaterial(changes)) { setInputWarning("인증정보로 보이는 내용은 기록하지 않았습니다. 비밀 없는 합성 결과 요약만 입력하세요."); return; }
    setInputWarning("");
    refresh();
    update(previous => {
      if (confirmedTarget && ("apiPath" in changes || "method" in changes)) return previous;
      const invalidatesExecution = ["apiPath", "method", "changedFiles", "changes", "accessComparison"].some(field => field in changes);
      return { ...previous, ...changes,
        performedManually: changes.performedManually ?? (invalidatesExecution ? false : previous.performedManually),
        retestStatus: changes.retestStatus ?? (previous.retestStatus === "RECORDED" ? "PLANNED" : previous.retestStatus) };
    });
  };
  const validation = validateManualRetest(draft, now);
  const accessComplete = !accessPlan || Boolean(draft.accessComparison && accessChronologyValid(draft.accessComparison.initial, draft.accessComparison.retest) && accessRoundComplete(draft.accessComparison.initial, now) && accessRoundComplete(draft.accessComparison.retest, now));
  const complete = validation.valid && accessComplete;
  const retestStatus = !accessComplete && validation.retestStatus === "RECORDED" ? "PLANNED" : validation.retestStatus;
  const statuses = (field: "status" | "afterStatus", label: string) => <label>{label}<select value={draft[field]}
    onChange={event => patch({ [field]: event.target.value as SecurityRecordDraft[typeof field] })}>
    {Object.entries(manualStatusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
  </select></label>;
  const note = (field: "inspectionMethod" | "beforeObservation" | "memo" | "changedFiles" | "changes" | "retestMethod" | "afterObservation", label: string) =>
    <label>{label}<textarea rows={3} maxLength={4000} value={draft[field]} onChange={event => patch({ [field]: event.target.value })} /></label>;
  return <section className={`tutor-card ${styles.record}`} aria-label={`${securityRecordLabels[kind]} 검사 결과 기록`}>
    <h3>{securityRecordLabels[kind]} · 검사 결과 기록 및 수정·재검증</h3>
    <p><strong>출처: 사용자 수동 기록</strong> · 상태와 관찰 내용은 사용자 작성입니다. 서버 검증 결과나 자동 취약점 확정으로 취급하지 않습니다.</p>
    {inputWarning && <p role="alert">{inputWarning}</p>}
    {observations && <aside><p>HTTP 관찰 요약을 수동 메모로 복사할 수 있습니다. 사용자 판단·수행 확인·수정 완료 상태는 자동 선택하지 않습니다. 기존 관찰 메모를 대체합니다.</p>
      <button type="button" onClick={() => patch({ beforeObservation: observations.initial, inspectionMethod: "정상값과 고정 마커의 HTTP 응답 비교 · 사용자 복사 메모", performedManually: false })}>최초 HTTP 관찰 요약을 수동 메모로 복사</button>
      {observations.latest && <button type="button" onClick={() => patch({ afterObservation: observations.latest!, retestMethod: "선택한 이전 관찰과 현재 관찰의 수동 비교 · 각 SHA·대상·수정 내역은 사용자 확인 필요", performedManually: false })}>후속 HTTP 관찰 요약을 수동 메모로 복사</button>}
    </aside>}
    {confirmedTarget && <><p>사용자 확정 대상 · 실행 승인 아님. 대상 변경은 실습 대상 설정에서 진행하세요.</p>
      <dl className="repository-metadata">{Object.entries({ "배포 URL": confirmedTarget.deploymentUrl ?? "별도 지정 없음",
        "입력 위치": confirmedTarget.inputLocation || "별도 지정 없음", "파라미터": confirmedTarget.parameter || "별도 지정 없음",
        ...confirmedTarget.details }).filter(([label]) => label !== "accessPlan").map(([label, value]) => <div key={label}><dt>{label}</dt><dd><pre>{value}</pre></dd></div>)}</dl></>}
    <p>이 화면에서 새 HTTP 요청이나 재검증을 실행하지 않습니다. 작성 중인 초안은 화면 세션에서만 유지됩니다. DB 저장한 기록은 결과 페이지에서 조회·수정할 수 있습니다. 내 웹서비스 재분석에서 커밋이나 분석 구조가 달라지면 이전 분석 기록으로 분리 보관합니다.</p>
    <p role="status">시스템 판정: 서버 검증 근거 없음 · 판정 불가. 재검증 기록 상태: {retestRecordLabels[retestStatus]}{retestStatus === "RECORDED" ? " (사용자 수행 기록 · 서버 미검증)" : ""}</p>
    {invalidPlan && <p role="alert">저장된 접근 정책 형식을 확인하지 못했습니다. 기존 기록은 읽기 전용으로 두고 새 대상을 등록하세요.</p>}
    {accessPlan && draft.targetSnapshot && <AccessComparison key={recordKey} target={draft.targetSnapshot} plan={accessPlan} value={draft.accessComparison}
      binding={recordContext || store?.persistence ? { ...(recordContext ?? store!.persistence!), recordKey } : undefined} now={now} readOnly={readOnly || draft.view === "COMPARE"}
      onChange={value => patch({ accessComparison: value, performedAt: localDateTimeValue(value.retest.performedAt) })} onSummary={(phase, summary) => patch(phase === "initial" ? { inspectionMethod: "계정·리소스 또는 역할·작업의 수동 HTTP 정책 비교", beforeObservation: summary, performedManually: false } : { retestMethod: "수정 후 사용자 수동 HTTP 정책 비교 · 관찰 SHA는 사용자 진술", afterObservation: summary, performedManually: false })} />}
    {!accessComplete && <p role="status">비교 표의 최초·재검증 수행 정보와 각 사례의 응답 요약·판단 근거를 기록하세요. 확인 불가 결과도 이유와 함께 기록할 수 있습니다.</p>}
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {draft.view === "COMPARE" ? <>
      <h4>수정 전후 결과 비교 · 수동 기록</h4>
      <dl className="repository-metadata">
        <div><dt>유형 / 대상</dt><dd>{securityRecordLabels[kind]} · {draft.method} {draft.apiPath || "미입력"}</dd></div>
        <div><dt>관련 코드 위치</dt><dd>{draft.codeLocation || "미입력"}</dd></div>
        <div><dt>수정한 파일</dt><dd><pre>{draft.changedFiles || "미입력"}</pre></dd></div>
        <div><dt>수정 내용</dt><dd><pre>{draft.changes || "미입력"}</pre></dd></div>
        <div><dt>사용자 메모</dt><dd><pre>{draft.memo || "없음"}</pre></dd></div>
      </dl>
      <div className="vl-two-col">
        <article><h4>수정 전</h4><p>사용자 선택 상태: {manualStatusLabels[draft.status]}</p><h5>검사 방법</h5><pre>{draft.inspectionMethod || "미입력"}</pre><h5>관찰 내용</h5><pre>{draft.beforeObservation || "미입력"}</pre></article>
        <article><h4>수정 후</h4><p>{retestStatus === "RECORDED" ? "사용자 수행 결과 기록 완료 · 서버 미검증" : "재검증 결과 미완료 · 아래 내용은 초안"}</p>
          <p>사용자 선택 상태: {manualStatusLabels[draft.afterStatus]}</p><p>사용자 기록 수행 일시: {draft.performedAt || "없음"}</p><h5>재검증 방법</h5><pre>{draft.retestMethod || "미입력"}</pre><h5>관찰 내용</h5><pre>{draft.afterObservation || "미입력"}</pre></article>
      </div>
      <button type="button" className="secondary-action" onClick={() => update(previous => ({ ...previous, view: "EDIT" }))}>기록 수정으로 돌아가기</button>
    </> : <>
      <label>취약점 유형<input readOnly value={securityRecordLabels[kind]} /></label>
      <label>검사 대상 API<input readOnly={Boolean(confirmedTarget)} maxLength={512} value={draft.apiPath} onChange={event => patch({ apiPath: event.target.value })} /></label>
      <label>HTTP 메서드<select disabled={Boolean(confirmedTarget)} value={draft.method} onChange={event => patch({ method: event.target.value })}>{[...new Set(["", ...practiceMethods, draft.method])].map(method => <option key={method} value={method}>{method || "선택"}</option>)}</select></label>
      {statuses("status", "검사 상태 (사용자 선택)")}
      {note("inspectionMethod", "검사 방법")}{note("beforeObservation", "수정 전 관찰 내용")}
      <label>관련 코드 위치<input maxLength={1000} value={draft.codeLocation} onChange={event => patch({ codeLocation: event.target.value })} /></label>
      {note("memo", "사용자 메모")}
      <h4>수정 및 재검증 관리</h4>
      {note("changedFiles", "수정한 파일")}{note("changes", "수정 내용 메모")}
      <label>재검증 상태<select value={retestStatus} onChange={event => {
        const value = event.target.value; if (value === "NOT_STARTED" || value === "PLANNED") patch({ retestStatus: value });
      }}><option value="NOT_STARTED">미진행</option><option value="PLANNED">진행 예정</option><option value="RECORDED" disabled>결과 기록 완료 (수동)</option></select></label>
      <label><input type="checkbox" checked={draft.performedManually} onChange={event => patch({ performedManually: event.target.checked })} /> 별도 테스트 환경에서 직접 재검증을 수행했으며 아래에 그 결과를 기록합니다 (사용자 진술·서버 미검증).</label>
      <label>재검증 수행 일시<input type="datetime-local" readOnly={Boolean(accessPlan)} value={draft.performedAt} onChange={event => patch({ performedAt: event.target.value })} /></label>
      {accessPlan && <p>재검증 일시는 비교 표에서 입력하며 UTC로 보관·검증합니다. 위 값은 현재 기기 시간대의 표시입니다.</p>}
      {note("retestMethod", "재검증 방법")}{statuses("afterStatus", "수정 후 검사 상태 (사용자 선택)")}{note("afterObservation", "수정 후 관찰 내용")}
      <p>유효한 대상·메서드, 최초 검사 방법·관찰, 수행 여부·과거 또는 현재 일시·재검증 방법·전후 관찰과 수정 내역이 필요합니다. 일시는 현재 기기의 시간대를 기준으로 확인합니다. 실제 서버 검증 완료나 취약점 해결을 뜻하지 않습니다.</p>
      {!complete && <div role="status"><p>완료 전에 확인할 항목</p><ul>{Object.entries(validation.errors).map(([field, message]) => <li key={field}>{message}</li>)}</ul></div>}
      <button type="button" className="secondary-action" disabled={!complete} onClick={() => {
        const completedAt = Date.now();
        refresh();
        update(previous => validateManualRetest(previous, completedAt).valid && (!accessPlan || previous.accessComparison && accessChronologyValid(previous.accessComparison.initial, previous.accessComparison.retest) && accessRoundComplete(previous.accessComparison.initial, completedAt) && accessRoundComplete(previous.accessComparison.retest, completedAt))
          ? { ...previous, retestStatus: "RECORDED", view: "COMPARE" } : previous);
      }}>수동 재검증 결과 기록 완료</button>
      <button type="button" className="secondary-action" onClick={() => update(previous => ({ ...previous, view: "COMPARE" }))}>수정 전후 비교 보기</button>
    </>}
    {store?.persistence && draft.targetSnapshot && <RecordPersistence context={store.persistence} recordKey={recordKey} kind={kind} draft={draft} onLoad={loaded => update(() => loaded)} />}
    </fieldset>
    {onBack && <button type="button" className="secondary-action" onClick={onBack}>실습 준비로 돌아가기</button>}
  </section>;
}
