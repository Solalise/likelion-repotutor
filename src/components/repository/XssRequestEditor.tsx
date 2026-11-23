"use client";
import { ManagedProbeEditor, type ManagedProbeEditorProps, type ProbeEditorDefinition } from "./ManagedProbeEditor";
import { HttpEvidence } from "./HttpEvidence";
import { useXssObservationHistory } from "./XssObservationHistory";
import { safeXssProbe, isSafeXssPair } from "@/lib/security-lab/xssProbe";
import { xssTargetKey, type XssRequestDraft, type XssComparisonResult } from "@/lib/security-lab/xssTypes";
import { analyzeXssReflection, xssObservationNote, xssReflectionLabels } from "@/lib/security-lab/xssReflection";
import styles from "./sqliRequestEditor.module.css";

export function XssResponseComparison({ result, attempted = false }: { result: XssComparisonResult | null; attempted?: boolean }) {
  const reflection = analyzeXssReflection(result, attempted);
  return <section aria-label="XSS 비실행 마커 응답 비교">
    <h4>정상 입력 · 비실행 마커 관찰</h4>
    <p role="status">관찰 상태: <strong>{xssReflectionLabels[reflection.status]}</strong></p><p>{reflection.reason}</p>
    <p>실제 스크립트 실행 여부는 미검증입니다. 마커 반영만으로 XSS 취약점을 확정하지 않습니다. 브라우저 실행·DOM 삽입·이벤트 핸들러 검사는 수행하지 않습니다.</p>
    {result && <dl className="repository-metadata"><div><dt>출처</dt><dd>서버 수집 HTTP 관찰 · 사용자 판단과 별도</dd></div><div><dt>실행 ID</dt><dd>{result.runId}</dd></div><div><dt>확정 반영 위치 / 예상 문맥</dt><dd>{result.request.target.reflectionLocation} / {result.request.target.reflectionContext} · 위치의 실제 DOM 일치는 사용자 확인 필요</dd></div></dl>}
    <div className={styles.grid}><article><h5>정상 응답</h5><HttpEvidence evidence={result?.baseline ?? null} /></article><article><h5>마커 응답</h5><HttpEvidence evidence={result?.test ?? null} /></article></div>
    <ul>{reflection.occurrences.map((row, index) => <li key={index}>관찰 HTML 문맥: {row.context} · 인코딩: {row.encoding}<pre>{row.excerpt}</pre></li>)}</ul>
    <p>HTML은 모두 텍스트로 표시합니다. 인코딩 관찰은 해당 응답의 제한된 문맥에만 해당하며 저장형·DOM XSS 또는 전체 서비스 안전성을 보장하지 않습니다.</p>
  </section>;
}
const definition: ProbeEditorDefinition<XssRequestDraft> = { kind: "XSS", title: "XSS", shortLabel: "XSS", endpoint: "xss", testValue: safeXssProbe.value, fixedBaseline: safeXssProbe.baseline,
  validInputs: isSafeXssPair, useHistory: useXssObservationHistory, note: xssObservationNote, Comparison: XssResponseComparison,
  testDescription: "고정 비실행 HTML 인코딩 마커만 사용합니다. 태그 이름·JavaScript·이벤트 핸들러·URL·데이터 유출 코드는 포함하지 않습니다.", invalidInputs: "정상 입력과 테스트 마커는 사전 정의된 고정값만 허용합니다." };
export function XssRequestEditor(props: ManagedProbeEditorProps<XssRequestDraft>) { return <ManagedProbeEditor key={xssTargetKey(props.initialDraft)} {...props} definition={definition} />; }
