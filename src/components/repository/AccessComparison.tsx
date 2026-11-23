"use client";
import { useState } from "react";
import { practiceTargetIdentity, type ConfirmedPracticeTarget } from "@/types/securityPracticeTarget";
import { localDateTime, localDateTimeValue } from "@/types/securityTestRecord";
import { accessCases, accessDecisionLabels, accessAssessmentLabels, assessAccess, observedAccess, accessObservationDifference, accessPairDifferences, accessChronologyValid, emptyAccessComparison, containsCredentialMaterial, accessImportTemplate, parseAccessImport, accessRoundSummary,
  type AccessPlan, type AccessBinding, type AccessRound, type AccessObservation, type ManualAccessComparison, type AccessDecision } from "@/lib/security-lab/manualAccess";
import styles from "./accessComparison.module.css";

type Props = { target: ConfirmedPracticeTarget; plan: AccessPlan; value?: ManualAccessComparison; binding?: AccessBinding; now: number; readOnly?: boolean; onChange?: (value: ManualAccessComparison) => void; onSummary?: (phase: "initial" | "retest", summary: string) => void };
export function AccessComparison({ target, plan, value, binding, now, readOnly = false, onChange, onSummary }: Props) {
  const [phase, setPhase] = useState<"initial" | "retest">("initial");
  const [importText, setImportText] = useState(""); const [message, setMessage] = useState(""); const [showTemplate, setShowTemplate] = useState(false);
  const mismatched = Boolean(value && (value.targetIdentity !== practiceTargetIdentity(target) || binding && value.initial.commitSha && value.initial.commitSha !== binding.commitSha));
  const locked = readOnly || mismatched;
  const comparison = !mismatched && value ? value : emptyAccessComparison(target, plan, binding?.commitSha);
  const cases = accessCases(plan, target), round = comparison[phase];
  const chronologyValid = accessChronologyValid(comparison.initial, comparison.retest);
  function change(next: ManualAccessComparison) {
    if (locked || !onChange) return;
    if (containsCredentialMaterial(next)) { setMessage("인증정보로 보이는 입력은 기록하지 않았습니다. 헤더·쿠키·비밀번호·토큰을 제거한 합성 결과 요약만 입력하세요."); return; }
    setMessage(""); onChange(next);
  }
  const editRound = (patch: Partial<AccessRound>) => change({ ...comparison, [phase]: { ...round, ...patch } });
  const editObservation = (id: string, patch: Partial<AccessObservation>) => editRound({ observations: { ...round.observations, [id]: { ...round.observations[id], ...patch } } });
  return <section className="tutor-card" aria-label={`${plan.kind === "IDOR" ? "IDOR 계정·리소스" : "권한 역할·작업"} 수동 비교`}>
    <h4>{plan.kind === "IDOR" ? "계정 A/B · 소유/교차 리소스 비교" : "역할별 API·작업 접근 비교"}</h4>
    <p>출처: 사용자 직접 입력·가져오기 · 서버 미검증. 이 화면은 요청을 전송하거나 인증정보를 수집하지 않습니다. 승인된 격리 환경에서 얻은 합성 결과의 상태 코드와 비밀 정보가 없는 요약만 기록하세요. 원본 HTTP·HAR·헤더·쿠키·토큰은 지원하지 않습니다.</p>
    {mismatched && <p role="alert">다른 대상·분석의 관찰은 현재 결과로 재사용하지 않습니다. 빈 비교표를 읽기 전용으로 표시합니다.</p>}
    {!chronologyValid && <p role="alert">재검증 수행 일시는 최초 관찰보다 이전일 수 없습니다. 저장 전에 일시를 확인하세요.</p>}
    <label>관찰 단계<select value={phase} onChange={event => { setPhase(event.target.value as "initial" | "retest"); setImportText(""); setMessage(""); }}><option value="initial">최초 검사</option><option value="retest">수정 후 재검증</option></select></label>
    <fieldset disabled={locked}>
      <label>관찰 커밋 SHA (사용자 진술 · 서버 확인 아님)<input value={round.commitSha} maxLength={40} readOnly={phase === "initial" && Boolean(binding)} onChange={event => editRound({ commitSha: event.target.value })} /></label>
      <p>분석 기록 SHA: {binding?.commitSha ?? "분석 연결 없음"}. 최초 관찰은 분석 SHA에 묶입니다. 재검증 SHA는 사용자 진술이며 저장소·분석 기록의 SHA를 바꾸지 않습니다.</p>
      <label>관찰 수행 일시<input type="datetime-local" value={localDateTimeValue(round.performedAt)} onChange={event => { const time = localDateTime(event.target.value); editRound({ performedAt: time === null ? "" : new Date(time).toISOString() }); }} /></label>
      <label><input type="checkbox" checked={round.environmentConfirmed} onChange={event => editRound({ environmentConfirmed: event.target.checked })} /> 명시적으로 승인된 격리 환경의 테스트 별칭·합성 리소스이며 해당 HTTP 결과를 직접 확인했습니다 (사용자 진술).</label>
      <div className={styles.scroll}><table className={styles.table}><caption>{phase === "initial" ? "최초 검사" : "수정 후 재검증"} · 기대 정책과 사용자 관찰</caption><thead><tr><th>계정/역할 · 리소스/작업</th><th>기대 정책</th><th>HTTP 상태</th><th>실제 접근 (사용자 선택)</th><th>응답 요약 · 판단 근거</th><th>정책 비교</th></tr></thead><tbody>
        {cases.map(row => { const o = round.observations[row.id], actual = observedAccess(round, o, now); return <tr key={row.id}>
          <th scope="row">{row.actor} · {row.resource}<p>{row.operation} · 소유/정책: {row.owner}</p><code>{row.method} {row.apiPath}</code></th>
          <td>{accessDecisionLabels[row.expected]}</td>
          <td><input aria-label={`${row.id} HTTP 상태`} type="number" min={100} max={599} value={o.statusCode ?? ""} onChange={event => editObservation(row.id, { statusCode: event.target.value === "" ? null : Number(event.target.value) })} /></td>
          <td><select aria-label={`${row.id} 실제 접근`} value={o.access} onChange={event => editObservation(row.id, { access: event.target.value as AccessDecision })}>{Object.entries(accessDecisionLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></td>
          <td><label>비밀 없는 응답 요약<textarea aria-label={`${row.id} 응답 요약`} maxLength={600} value={o.responseSummary} onChange={event => editObservation(row.id, { responseSummary: event.target.value })} /></label><label>접근 판단 근거<textarea aria-label={`${row.id} 판단 근거`} maxLength={240} value={o.rationale} onChange={event => editObservation(row.id, { rationale: event.target.value })} /></label></td>
          <td>{accessAssessmentLabels[assessAccess(row.expected, actual)]}<p>유효 관찰: {accessDecisionLabels[actual]}</p></td>
        </tr>; })}
      </tbody></table></div>
      <p>HTTP 200/403만으로 접근을 추정하지 않습니다. 일시·SHA·격리 확인과 응답 요약·근거가 부족하면 확인 불가입니다. 예상 거부인데 사용자 관찰이 허용이면 정책 위반 의심으로만 표시합니다.</p>
      <details><summary>동일 계정·작업의 응답 차이</summary><ul>{accessPairDifferences(plan, target, round).map((pair, index) => <li key={index}>{pair.label} · HTTP: {pair.statusChanged === null ? "확인 불가" : pair.statusChanged ? "다름" : "같음"} · 사용자 요약: {pair.summaryChanged === null ? "확인 불가" : pair.summaryChanged ? "다름" : "같음"}</li>)}</ul></details>
      {onSummary && <button type="button" onClick={() => { if (!locked) onSummary(phase, accessRoundSummary(plan, target, round, now)); }}>현재 비교 요약을 검사 기록 메모로 복사</button>}
      <details><summary>비밀 없는 JSON 결과 가져오기</summary><p>현재 저장소·분석 SHA·대상 버전·단계가 일치하는 전용 JSON만 받습니다. 임의 URL 가져오기, 원본 HTTP/HAR 및 추가 필드는 거부합니다.</p>
        <button type="button" disabled={!binding} onClick={() => setShowTemplate(v => !v)}>현재 대상 JSON 양식 보기</button>
        {showTemplate && binding && <textarea aria-label="가져오기 JSON 양식" rows={8} readOnly value={JSON.stringify(accessImportTemplate(binding, target, phase, emptyAccessComparison(target, plan, binding.commitSha)[phase]), null, 2)} />}
        <textarea aria-label="비밀 없는 결과 JSON" rows={6} maxLength={32000} value={importText} onChange={event => { if (containsCredentialMaterial(event.target.value)) { setImportText(""); setMessage("인증정보로 보이는 가져오기 내용을 지웠습니다. 전용 JSON 양식만 사용하세요."); } else setImportText(event.target.value); }} />
        <button type="button" disabled={!binding || !importText} onClick={() => { if (!binding || locked) return; try { const imported = parseAccessImport(importText, binding, target, plan, phase, now); change({ ...comparison, [phase]: imported }); setMessage("수동 결과를 화면에 가져왔습니다. DB 저장은 별도이며 서버 검증이나 취약점 확정이 아닙니다."); } catch { setMessage("가져오지 않았습니다. 현재 대상·단계의 전용 양식과 인증정보 제외 여부를 확인하세요."); } finally { setImportText(""); } }}>JSON 수동 결과 가져오기</button>
      </details>
    </fieldset><p role="status">{message}</p>
    <div className={styles.scroll}><table className={styles.table}><caption>최초 검사 · 수정 후 재검증 비교 (사용자 기록)</caption><thead><tr><th>계정/역할 · 대상</th><th>최초 관찰</th><th>재검증 관찰</th><th>상태·요약 차이</th></tr></thead><tbody>{cases.map(row => {
      const a = comparison.initial.observations[row.id], b = comparison.retest.observations[row.id], diff = accessObservationDifference(a, b);
      return <tr key={row.id}><th scope="row">{row.actor} · {row.resource} · {row.operation}<p>기대: {accessDecisionLabels[row.expected]}</p></th><td>{accessDecisionLabels[observedAccess(comparison.initial, a, now)]} · HTTP {a.statusCode ?? "없음"}<pre>{a.responseSummary || "미입력"}</pre><p>근거: {a.rationale || "미입력"}</p></td><td>{accessDecisionLabels[observedAccess(comparison.retest, b, now)]} · HTTP {b.statusCode ?? "없음"}<pre>{b.responseSummary || "미입력"}</pre><p>근거: {b.rationale || "미입력"}</p></td><td>HTTP: {diff.statusChanged === null ? "확인 불가" : diff.statusChanged ? "다름" : "같음"}<p>사용자 요약: {diff.summaryChanged === null ? "확인 불가" : diff.summaryChanged ? "다름" : "같음"}</p></td></tr>;
    })}</tbody></table></div><p>최초 SHA: {comparison.initial.commitSha || "미입력"} · 재검증 SHA: {comparison.retest.commitSha || "미입력"} · 양쪽 모두 사용자 진술, 서버 미검증입니다. 차이만으로 수정 성공을 판정하지 않습니다.</p>
  </section>;
}
