"use client";
import { useEffect, useState } from "react";
import type { RepositoryAnalysis } from "@/types/analysis";
import { securityRecordLabels, type SecurityRecordKind } from "@/types/securityTestRecord";
import { practiceTargetIdentity } from "@/types/securityPracticeTarget";
import { RepositoryDeployment } from "@/components/repository/RepositoryDeployment";
import { SourceCodeViewer } from "@/components/repository/SourceCodeViewer";
import { RecordPersistence, type SavedRecord } from "@/components/results/RecordPersistence";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import { containsCredentialMaterial } from "@/lib/security-lab/manualAccess";
import { scanPresentation } from "@/lib/repository/scanPresentation";
import { scanStatusLabels } from "@/types/scanCoverage";
import { confirmedReviewEnvironment, emptyProjectReview, projectGuideEvidence, reviewContentComplete, reviewFromRecord, reviewGuides, reviewKinds, reviewOutcomes, reviewProgress, reviewRecordDraft, reviewRecordKey, type ProjectReview, type ReviewOutcome } from "@/lib/security-lab/projectReview";
import styles from "./ProjectSecurityReview.module.css";
import { ExtensionReviewConnection } from "./ExtensionReviewConnection";
import Link from "next/link";
import { Database, CodeXml, Copy, ShieldCheck, PanelRight, ArrowRight } from "lucide-react";
import detail from "./ServiceDetail.module.css";

const emptyReviews = () => Object.fromEntries(reviewKinds.map(kind => [kind, emptyProjectReview()])) as Record<SecurityRecordKind, ProjectReview>;

export function ProjectSecurityReview({ analysis, connectionId, archived = false, id }: { analysis: RepositoryAnalysis; connectionId: string; archived?: boolean; id?: string }) {
  const [environment, setEnvironment] = useState<DeploymentConnectionSnapshot>();
  const environmentKey = JSON.stringify([environment?.connectionId, environment?.deploymentVersion, environment?.deployment.vercelUrl, environment?.deployment.ownershipStatus, environment?.deployment.verifiedAt]);
  return <section id={id} tabIndex={id ? -1 : undefined} className={styles.review} aria-label="내 웹서비스 전용 보안 검증">
    <h3 className={detail.sectionTitle}>보안 유형별 검토</h3>
    <div className={detail.typeGrid}>{reviewKinds.map((kind, index) => { const Icon = [Database, CodeXml, Copy, ShieldCheck][index]; const scan = scanPresentation(analysis, kind); return <article key={kind} className={detail.panel}><span className={detail.typeIcon}><Icon size={23} aria-hidden="true" /></span><h3>{securityRecordLabels[kind]}</h3><p className={detail.note}>{["SQL 쿼리 및 입력값 처리", "사용자 입력과 화면 출력", "데이터 소유권 및 접근 제한", "사용자 역할 및 서버 권한"][index]}</p><div className={detail.typeStatus}>정적 분석: {scanStatusLabels[scan.status]} · 후보 {scan.candidates}개</div><details><summary>검토 가이드 · 관련 근거 보기</summary><ReviewGuide analysis={analysis} kind={kind} /></details></article>; })}</div>
    {!archived && <section className={detail.panel}><div className={detail.startHeading}><span className={detail.typeIcon}><PanelRight size={25} aria-hidden="true" /></span><div><h3>내 웹서비스 검토 시작</h3><p className={detail.note}>Chrome 사이드 패널에서 단계별 안내를 확인하세요.</p></div></div><div className={detail.step}><span className={detail.stepNumber}>1</span><div><div className={detail.stepHeading}><h4>사이트 주소 등록 및 변경</h4><span>{environment?.deployment.vercelUrl ? "등록됨" : "선택 사항"}</span></div><p className={detail.note}>{environment?.deployment.vercelUrl ?? "일반 탐색으로 열 사이트 주소를 등록할 수 있습니다."}</p><details><summary>사이트 주소 등록 / 변경</summary><RepositoryDeployment connectionId={connectionId} environmentOnly registrationOnly onConnection={setEnvironment} /></details></div></div>
      <ExtensionReviewConnection key={environmentKey} analysis={analysis} connectionId={connectionId} environment={environment} /></section>}
    <ReviewWorkspace key={environmentKey} analysis={analysis} connectionId={connectionId} environment={environment} archived={archived} />
  </section>;
}

function ReviewWorkspace({ analysis, connectionId, environment, archived }: { analysis: RepositoryAnalysis; connectionId: string; environment?: DeploymentConnectionSnapshot; archived: boolean }) {
  const [selected, setSelected] = useState<SecurityRecordKind>("SQL_INJECTION");
  const [reviews, setReviews] = useState(emptyReviews);
  const [saved, setSaved] = useState<Partial<Record<SecurityRecordKind, SavedRecord>>>({});
  const [isolated, setIsolated] = useState(false);
  const [warning, setWarning] = useState("");
  const confirmed = confirmedReviewEnvironment(connectionId, environment);
  const [loading, setLoading] = useState(confirmed && !archived);
  const sha = analysis.collection?.commitSha;
  useEffect(() => {
    const controller = new AbortController();
    if (!confirmed || !environment || !sha || archived) return () => controller.abort();
    async function restore() {
      try {
        const found: Partial<Record<SecurityRecordKind, SavedRecord>> = {};
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (let page = 0; page < 10; page++) {
          const query = new URLSearchParams({ repository: analysis.repository, ...(cursor ? { cursor } : {}) });
          const response = await fetch(`/api/results?${query}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.records)) throw new Error(data.message ?? "저장된 검토 기록을 확인하지 못했습니다.");
          for (const row of data.records as SavedRecord[]) {
            if (!row || !reviewKinds.includes(row.kind) || found[row.kind] || row.repositoryFullName !== analysis.repository || row.commitSha !== sha
              || row.recordKey !== reviewRecordKey(connectionId, environment!.deploymentVersion, row.kind) || !row.draft?.targetSnapshot
              || typeof row.id !== "string" || !Number.isSafeInteger(row.revision) || row.revision < 1 || !reviewFromRecord(row.draft)) continue;
            const target = reviewRecordDraft(emptyProjectReview(), environment!).targetSnapshot!;
            if (practiceTargetIdentity(row.draft.targetSnapshot) === practiceTargetIdentity(target)) found[row.kind] = row;
          }
          if (!data.nextCursor || reviewKinds.every(kind => found[kind])) break;
          if (typeof data.nextCursor !== "string" || seen.has(data.nextCursor)) throw new Error("기록 목록의 페이지 정보를 확인하지 못했습니다.");
          seen.add(data.nextCursor); cursor = data.nextCursor;
          if (page === 9) setWarning("최근 1,000개 범위만 조회했습니다. 누락된 기록은 저장된 결과 목록에서 확인하세요.");
        }
        if (!controller.signal.aborted) {
          setSaved(found);
          setReviews(previous => ({ ...previous, ...Object.fromEntries(Object.entries(found).map(([kind, row]) => [kind, reviewFromRecord(row!.draft)!])) }));
        }
      } catch (error) { if (!controller.signal.aborted) setWarning(error instanceof Error ? error.message : "기록 조회 실패 · 새 검토 초안은 별도로 작성할 수 있습니다."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void restore();
    return () => controller.abort();
  }, [analysis.repository, sha, connectionId, environment, confirmed, archived]);
  const progress = reviewProgress(reviews);
  const recorded = reviewKinds.filter(kind => saved[kind] && reviewFromRecord(saved[kind]!.draft)?.outcome !== "UNSET").length;
  const edit = (kind: SecurityRecordKind, patch: Partial<ProjectReview>) => {
    if (archived) return;
    if (containsCredentialMaterial(patch)) { setWarning("인증정보는 기록할 수 없습니다. 비밀 없는 합성 관찰과 근거만 입력하세요."); return; }
    setReviews(previous => ({ ...previous, [kind]: { ...previous[kind], ...patch, completed: false } }));
  };
  return <><section className={detail.panel}><h3>종합 검토 결과</h3><p className={detail.note}>현재 분석 커밋·등록 환경의 DB 수동 관찰 기록</p>{!archived && confirmed && !loading && !warning ? <><div className={detail.progressLabel}><span>기록 진행률</span><strong>{recorded}/4 · {recorded * 25}%</strong></div><div className={detail.track} role="progressbar" aria-label="저장된 수동 관찰 기록 진행률" aria-valuemin={0} aria-valuemax={4} aria-valuenow={recorded}><span style={{ width: `${recorded * 25}%` }} /></div></> : <p className={detail.note}>{loading ? "저장 기록 조회 중" : warning || "현재 환경의 기록 집계를 확인할 수 없습니다. 종합 결과에서 확인하세요."}</p>}<Link className={detail.primary} href={`/services/${encodeURIComponent(connectionId)}/review`}>종합 검토 결과 보기 <ArrowRight size={17} aria-hidden="true" /></Link><p className={detail.note}>수동 기록 진행률은 실제 보안 검증 완료나 사이트 전체의 안전성을 뜻하지 않습니다.</p></section><details className={detail.panel}><summary>웹에서 가이드·수동 기록 확인 (보조 화면)</summary>
    <p role="status">전체 검토 진행률: {progress.completed}/4 · {progress.percent}% (사용자 수동 기록)</p>
    <progress aria-label="프로젝트 보안 검토 진행률" max={100} value={progress.percent} />
    {warning && <p role="alert">{warning}</p>}
    {loading && <p role="status">같은 저장소·커밋·테스트 환경의 저장 기록을 조회하는 중입니다.</p>}
    <div className={styles.cards} role="group" aria-label="보안 검증 유형">
      {reviewKinds.map((kind, index) => <button key={kind} type="button" aria-pressed={selected === kind} onClick={() => setSelected(kind)}>
        <strong>{index + 1}. {securityRecordLabels[kind]}</strong>
        <span>{reviews[kind].completed && reviewContentComplete(reviews[kind]) ? "검토 완료 (수동)" : Object.values(reviews[kind]).some(value => typeof value === "string" && value && value !== "UNSET") ? "진행 중" : "미시작"}</span>
        <span>정적 분석: {scanStatusLabels[scanPresentation(analysis, kind).status]} · 후보 {scanPresentation(analysis, kind).candidates}개</span>
        <span>사용자 결과: {reviewOutcomes[reviews[kind].outcome]}</span>
      </button>)}
    </div>
    <label><input type="checkbox" checked={isolated} disabled={archived} onChange={event => setIsolated(event.target.checked)} /> 등록 사이트가 내가 관리하는 비운영 격리 환경이며 분석 커밋의 코드·합성 데이터·테스트 계정만 사용함을 확인합니다 (사용자 진술·실행 승인 아님).</label>
    {!confirmed && <p>가이드는 지금 열 수 있습니다. 완료 기록은 위에서 테스트 사이트 소유권을 확인한 뒤 작성하세요. 환경 변경 시 별도 검토 범위로 시작합니다.</p>}
    {reviewKinds.map(kind => <div key={kind} hidden={selected !== kind}>
      <ReviewGuide analysis={analysis} kind={kind} />
      <fieldset disabled={archived || loading || !confirmed}>
        <h3>{securityRecordLabels[kind]} 결과 기록</h3><p><strong>출처: 사용자 수동 기록 · 서버 실행 근거 아님</strong></p>
        <label>기대 결과<textarea maxLength={1000} value={reviews[kind].expected} onChange={e => edit(kind, { expected: e.target.value })} /></label>
        <label>실제 관찰 결과<textarea maxLength={2000} value={reviews[kind].observed} onChange={e => edit(kind, { observed: e.target.value })} /></label>
        <label>사용자 기록 · 해당 없음 사유<textarea maxLength={800} value={reviews[kind].notes} onChange={e => edit(kind, { notes: e.target.value })} /></label>
        <label>검증 근거 · 비밀 없는 테스트 결과/문서 참조<textarea maxLength={800} value={reviews[kind].evidence} onChange={e => edit(kind, { evidence: e.target.value })} /></label>
        <label>관련 소스코드 위치 (미확인이면 비워 두세요)<input maxLength={1000} value={reviews[kind].codeLocation} onChange={e => edit(kind, { codeLocation: e.target.value })} /></label>
        <label>검증 결과<select value={reviews[kind].outcome} onChange={e => edit(kind, { outcome: e.target.value as ReviewOutcome })}>{Object.entries(reviewOutcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="button" className="primary-action" disabled={!isolated || !reviewContentComplete(reviews[kind])} onClick={() => setReviews(previous => ({ ...previous, [kind]: { ...previous[kind], completed: true } }))}>검토 완료 표시 (수동)</button>
        <p>완료 표시는 화면 진행 상태입니다. DB 저장 완료 메시지를 확인해야 영구 보관됩니다. 내용을 바꾸면 다시 완료 확인이 필요합니다.</p>
        {confirmed && environment && sha && !loading && <RecordPersistence key={reviewRecordKey(connectionId, environment.deploymentVersion, kind)} context={{ repositoryFullName: analysis.repository, commitSha: sha }} kind={kind}
          recordKey={reviewRecordKey(connectionId, environment.deploymentVersion, kind)} draft={reviewRecordDraft(reviews[kind], environment)} saved={saved[kind]}
          onLoad={draft => { const review = reviewFromRecord(draft); if (review) setReviews(previous => ({ ...previous, [kind]: review })); else setWarning("이 기록은 프로젝트 검토 형식과 일치하지 않습니다."); }} />}
      </fieldset>
      <button type="button" className="secondary-action" onClick={() => setSelected(reviewKinds[(reviewKinds.indexOf(kind) + 1) % 4])}>다음 유형 검토</button>
    </div>)}
    <details><summary>4가지 유형의 검토 현황 요약</summary><ul>{reviewKinds.map(kind => <li key={kind}>{securityRecordLabels[kind]} · {reviews[kind].completed && reviewContentComplete(reviews[kind]) ? "검토 완료 (수동)" : "미완료"} · {reviewOutcomes[reviews[kind].outcome]}</li>)}</ul><p>서비스 전체의 안전 판정은 제공하지 않습니다. 상세 종합 분석과 수정·재검증 연계는 다음 단계입니다.</p></details>
  </details></>;
}

export function ReviewGuide({ analysis, kind }: { analysis: RepositoryAnalysis; kind: SecurityRecordKind }) {
  const guide = reviewGuides[kind], evidence = projectGuideEvidence(analysis, kind);
  const savedGuide = analysis.savedReviewGuides?.guides.find(item => item.kind === kind);
  return <section aria-label={`${securityRecordLabels[kind]} 프로젝트별 검증 가이드`}>
    <h3>{securityRecordLabels[kind]} 프로젝트별 검증 가이드</h3><p>{guide.concept}</p>
    {savedGuide && <details><summary>저장된 검토 가이드{analysis.savedReviewGuides?.origin === "ai" ? " · 서버 검증된 AI 참고 설명" : " · 기본 안내"}</summary>
      {savedGuide.steps.map((step, i) => <div key={`${i}:${step.id}`}><h4>{step.action}</h4><p>{step.explanation}</p></div>)}
      {savedGuide.sources.map((source, i) => <p key={`${i}:${source.id}`}>{source.location} · {source.reason}</p>)}
    </details>}
    <h4>프로젝트에서 확인한 기능·코드와 분석 근거</h4>
    {!evidence.findings.length && <p>지원 범위에서 정적 후보를 확인하지 못했습니다. 관련 기능의 부재나 서비스 안전성을 뜻하지 않습니다. 아래 일반 검토 절차는 계속 이용할 수 있습니다.</p>}
    {evidence.findings.slice(0, 10).map((finding, i) => <details key={`${i}:${finding.id}`}><summary>{finding.filePath}:{finding.line} · 시스템 정적 분석 근거 (실행 미검증)</summary>
      <SourceCodeViewer sourceCode={finding.code} startLine={finding.line} highlightLine={finding.line} /><p>{finding.reason}</p>
      {finding.apiContexts?.map((api, i) => <p key={`${i}:${api.filePath}:${api.method}`}>관찰된 API: {api.method} {api.path} · {api.filePath} (정적 호출 관계·실행 미검증)</p>)}
      {"api" in finding && finding.api && <p>관찰된 API: {finding.api.method} {finding.api.path} · {finding.api.filePath}</p>}
      <ul>{finding.evidence.map((item, i) => <li key={i}>{item.filePath}:{item.line} · {item.description}<pre><code>{item.code}</code></pre></li>)}</ul>
      {"checks" in finding && <ul>{finding.checks.map((check, i) => <li key={i}>{check.kind} · {check.control} · {check.filePath}:{check.line}<pre><code>{check.code}</code></pre></li>)}</ul>}
      <p>권장 보안 처리: {finding.remediation}</p>
    </details>)}
    {evidence.findings.length > 10 && <p>처음 10개 근거를 표시합니다. 전체 항목은 아래 정적 분석 상세에서 확인하세요.</p>}
    {Boolean(evidence.points.length) && <details><summary>관찰된 실행/출력 지점 ({evidence.points.length}개 · 취약점 확정 아님)</summary><ul>{evidence.points.map((point, i) => <li key={i}>{point.filePath}:{point.line}<pre><code>{point.code}</code></pre></li>)}</ul></details>}
    <h4>정상적으로 기대되는 보안 동작</h4><p>{guide.expected}</p>
    <h4>소유권 확인된 격리 환경에서의 방어 검증 절차</h4><ol>{guide.procedure.map(step => <li key={step}>{step}</li>)}</ol>
    <h4>결과 기록 방법</h4><p>기대와 실제 관찰, 확인한 코드, 근거와 한계를 적으세요. 확인되지 않은 원인은 추정으로 표시하고, 검증할 수 없으면 판정 불가로 남기세요. 해당 없음도 이유가 필요합니다.</p>
    <h4>관련 보안 처리 방식</h4><p>{guide.defense}</p>
    <details><summary>이 프로젝트의 분석 지원 범위·한계</summary><ul>{evidence.limitations.map((limit, i) => <li key={`${i}:${limit}`}>{limit}</li>)}</ul></details>
  </section>;
}
