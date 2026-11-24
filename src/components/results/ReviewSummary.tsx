import Link from "next/link";
import type { RepositoryAnalysis } from "@/types/analysis";
import { securityRecordLabels, type SecurityRecordKind } from "@/types/securityTestRecord";
import { reviewKinds } from "@/lib/security-lab/projectReview";
import { summaryLabels, summaryProgress, type SummaryRecord } from "@/lib/results/reviewSummary";
import { scanPresentation } from "@/lib/repository/scanPresentation";
import { scanStatusLabels } from "@/types/scanCoverage";
import { SourceCodeViewer } from "@/components/repository/SourceCodeViewer";
import { containsCredentialMaterial } from "@/lib/security-lab/manualAccess";
import styles from "./ReviewSummary.module.css";

function RecordDetails({ item, analysis }: { item: SummaryRecord; analysis?: RepositoryAnalysis }) {
  const { row, review } = item;
  const excerpts = row.draft.codeLocation.split("\n").flatMap(location => {
    const match = location.trim().match(/^(.+):(\d+)$/), file = match && analysis?.files.find(file => file.path === match[1]);
    if (!match || !file) return [];
    const line = Number(match[2]), lines = file.sourceCode.split("\n");
    if (line < 1 || line > lines.length) return [];
    const start = Math.max(1, line - 2), code = lines.slice(start - 1, line + 3).join("\n");
    return containsCredentialMaterial(code) ? [] : [{ location, line, start, code }];
  }).slice(0, 3);
  return <details className={styles.detail}><summary>{summaryLabels[item.outcome]} · {new Date(row.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 수동 기록 상세</summary>
    <p>사용자가 저장한 관찰이며 시스템이 실제 동작을 검증한 결과가 아닙니다.</p>
    <dl><dt>기대 결과</dt><dd><pre>{review?.expected || "개별 기록에 기대 결과가 별도 저장되지 않았습니다."}</pre></dd>
      <dt>실제 관찰 결과</dt><dd><pre>{review?.observed || row.draft.beforeObservation || "미입력"}</pre></dd>
      <dt>확인 방법·검증 근거</dt><dd><pre>{review?.evidence || row.draft.inspectionMethod || "미입력"}</pre></dd>
      <dt>사용자 메모</dt><dd><pre>{(review?.notes ?? row.draft.memo) || "미입력"}</pre></dd>
      <dt>관련 코드 위치 (수동 입력)</dt><dd><pre>{row.draft.codeLocation || "미입력"}</pre></dd>
      <dt>기록 대상</dt><dd>{item.site ?? "사이트 미등록"} · {item.environmentVersion === null ? "환경 버전 미확인" : `환경 버전 ${item.environmentVersion}`}</dd></dl>
    {excerpts.map(excerpt => <section key={excerpt.location}><h4>{excerpt.location} · 해당 커밋 코드 발췌</h4><p>사용자가 입력한 위치에 대응하는 코드이며, 취약점이나 입력 흐름의 증명이 아닙니다.</p><SourceCodeViewer sourceCode={excerpt.code} startLine={excerpt.start} highlightLine={excerpt.line}/></section>)}
    {!excerpts.length && <p>해당 커밋에서 대응하는 코드 본문을 확인하지 못했습니다. 입력된 위치를 코드 근거로 자동 확정하지 않습니다.</p>}
    <Link href={`/results/${row.id}`}>기존 저장 기록 열기</Link>
  </details>;
}
function StaticReference({ analysis, kind }: { analysis?: RepositoryAnalysis; kind: SecurityRecordKind }) {
  if (!analysis) return <details><summary>시스템 정적 분석 참고 · 캐시 없음</summary><p>이 커밋의 분석 캐시가 없거나 만료되어 코드 근거를 조회하지 못했습니다. 수동 기록은 DB에 유지됩니다.</p></details>;
  const presentation = scanPresentation(analysis, kind);
  const report = kind === "SQL_INJECTION" ? analysis.sqlInjection : kind === "XSS" ? analysis.xss : analysis.accessControl;
  const findings = report?.findings.filter(f => f.type === kind && !containsCredentialMaterial(f.code)) ?? [];
  return <details><summary>시스템 정적 분석 참고 · {scanStatusLabels[presentation.status]} · 후보 {presentation.candidates}개</summary>
    <p>수동 관찰과 별개인 정적 코드 분석입니다. 후보 없음은 안전 판정이 아니며 실제 실행 결과도 아닙니다.</p>
    {findings.slice(0, 3).map(f => <section key={f.id}><h4>{f.filePath}:{f.line}</h4><SourceCodeViewer sourceCode={f.code} startLine={f.line}/><p>{f.reason}</p>{f.evidence.slice(0, 3).map((e, i) => <p key={i}>{e.filePath}:{e.line} · {e.description}</p>)}</section>)}
    {!findings.length && <p>표시할 정적 코드 후보가 없습니다. 미지원·일부 분석 상태와 후보 없음을 구분해 주세요.</p>}
    {findings.length > 3 && <p>대표 근거 3개만 표시합니다. 전체 정적 결과는 저장소 분석 화면에서 확인하세요.</p>}
  </details>;
}
export function ReviewSummarySection({ title, records, analysis, showStatic = false }: { title: string; records: SummaryRecord[]; analysis?: RepositoryAnalysis; showStatic?: boolean }) {
  const progress = summaryProgress(records);
  return <section aria-label={title}><h2>{title}</h2><p>수동 판정 기록 {progress.recorded}/4 · {progress.percent}%</p><progress max={4} value={progress.recorded} aria-label={`${title} 수동 기록 진행률`}/>
    <p>유형별 가장 최근 저장 판정을 요약합니다. 미기록 유형은 다른 버전의 기록으로 채우지 않습니다.</p>
    <div className={styles.grid}>{reviewKinds.map(kind => {
      const items = records.filter(item => item.row.kind === kind), latest = progress.latest[kind];
      return <article className="vl-card" key={kind}><h3>{securityRecordLabels[kind]}</h3><p className={styles.result}>{summaryLabels[latest?.outcome ?? "UNSET"]}</p><p>저장된 수동 기록 {items.length}개</p>
        {items.map(item => <RecordDetails key={item.row.id} item={item} analysis={analysis}/>)}
        {!items.length && <p>이 버전·범위의 수동 관찰 기록이 없습니다.</p>}
        {showStatic && <StaticReference analysis={analysis} kind={kind}/>}
      </article>;
    })}</div>
  </section>;
}
