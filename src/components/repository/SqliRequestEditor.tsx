"use client";
import { sqliHttpDifference, sqliAssessmentLabels, sqliDisplayAssessment, sqliObservationNote, sqliTargetKey, type SqliRequestDraft, type SqliComparisonResult } from "@/lib/security-lab/sqliTypes";
import { isSafeSqliPair, safeSqliProbe } from "@/lib/security-lab/sqliProbe";
import { ManagedProbeEditor, type ManagedProbeEditorProps, type ProbeEditorDefinition } from "./ManagedProbeEditor";
import { HttpEvidence } from "./HttpEvidence";
import { SecurityTestRecord } from "./SecurityTestRecord";
import { useSqliObservationHistory } from "./SqliObservationHistory";
import styles from "./sqliRequestEditor.module.css";
/** Response bodies are rendered as text, never as HTML or scripts. */
export function SqliResponseComparison({ result, attempted = false }: { result: SqliComparisonResult | null; attempted?: boolean }) {
  const assessment = !result && attempted ? { status: "INCONCLUSIVE" as const, reason: "실행을 요청했지만 표시할 HTTP 응답 근거가 없습니다. 처리 중이거나 이미 전송되었을 수 있으므로 실행 안내를 확인하고 자동 재시도하지 마세요." } : sqliDisplayAssessment(result);
  const diff = result && sqliHttpDifference(result);
  return <section aria-label="SQLi 응답 비교">
    <h4>정상 응답 · 테스트 응답 비교</h4>
    <p role="status">결과 상태: <strong>{sqliAssessmentLabels[assessment.status]}</strong></p>
    <p>{assessment.reason}</p>
    {diff && <p>HTTP 상태: {diff.statusChanged === null ? "비교 불가" : diff.statusChanged ? "차이 있음" : "동일"} · 본문: {diff.bodyChanged === null ? "비교 불가 (오류·차단·잘림 여부 확인)" : diff.bodyChanged ? "차이 있음" : "동일"}. 이 표시는 관찰값 비교이며 취약점 판정이 아닙니다.</p>}
    <p>상태 구분: 미실행 / 판정 불가 / 취약점 확인 / 취약 동작 미관찰. 마지막 두 상태는 향후 서버 검증 근거가 연결되어야 사용할 수 있습니다.</p>
    <div className={styles.grid}>
      <article aria-label="정상 응답"><h4>정상 응답</h4><HttpEvidence evidence={result?.baseline ?? null} /></article>
      <article aria-label="테스트 응답"><h4>테스트 응답</h4><HttpEvidence evidence={result?.test ?? null} /></article>
    </div>
    <p>상태 코드·시간·본문 차이만으로 SQLi 성공을 추정하지 않습니다. 취약 동작 미관찰도 서비스 전체의 안전을 의미하지 않습니다.</p>
    {result && <SecurityTestRecord source="SERVER" result={result} />}
  </section>;
}


const definition: ProbeEditorDefinition<SqliRequestDraft> = { kind: "SQL_INJECTION", title: "SQL Injection", shortLabel: "SQLi", endpoint: "sqli", testValue: safeSqliProbe.value,
  validInputs: isSafeSqliPair, useHistory: useSqliObservationHistory, note: sqliObservationNote, Comparison: SqliResponseComparison,
  testDescription: "고정 따옴표 마커 · 오류 관찰용. 임의 SQL·조건식·지연·데이터 추출 입력은 허용하지 않습니다.", invalidInputs: "정상값은 합성 식별자의 영문·숫자·밑줄 1~128자로 입력하세요. 테스트값은 고정 마커만 사용합니다." };
export function SqliRequestEditor(props: ManagedProbeEditorProps<SqliRequestDraft>) { return <ManagedProbeEditor key={sqliTargetKey(props.initialDraft)} {...props} definition={definition} />; }
