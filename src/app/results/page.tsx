import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import Link from "next/link";
import { Github, Layers, ClipboardList, FileCheck2, GitCommitHorizontal, ArrowRight, Info } from "lucide-react";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/currentUser";
import { requireRepositoryAccess } from "@/lib/github/repositoryAccess";
import { db } from "@/lib/db";
import { summarizeManualRecords, summaryProgress, summaryLabels } from "@/lib/results/reviewSummary";
import { reviewKinds } from "@/lib/security-lab/projectReview";
import { securityRecordLabels } from "@/types/securityTestRecord";
import type { SavedRecord } from "@/components/results/RecordPersistence";
import styles from "./Results.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "서비스별 검증 결과" };
export default async function Page() {
  const userId = await currentUserId(); if (!userId) redirect("/login");
  let connections;
  try {
    connections = await db.userRepository.findMany({ where: { userId, active: true, removedAt: null }, select: { id: true }, orderBy: { connectedAt: "desc" } });
  } catch {
    return <PlatformShell><main id="main-content" className="vl-main"><h1>검증 결과</h1><p role="alert">서비스 목록을 조회하지 못했습니다. 기록이 없다는 뜻이 아니며 DB 데이터는 변경하지 않았습니다.</p><Link href="/services">내 웹서비스</Link></main></PlatformShell>;
  }
  const services = await Promise.all(connections.map(async ({ id }) => {
    let connection;
    try { connection = await requireRepositoryAccess(userId, id); }
    catch { return null; } // Never expose repository metadata before the existing access check.
    const heading = <header className={styles.cardHeading}><span className={styles.github}><Github size={25} aria-hidden="true" /></span><div><h2>{connection.repository.name || connection.repository.fullName.split("/").at(-1)}</h2><a href={connection.repository.htmlUrl} target="_blank" rel="noopener noreferrer" title={connection.repository.fullName}>{connection.repository.fullName.split("/")[0]}</a></div></header>;
    try {
      const [analysis, rows] = await Promise.all([
        db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, source: "CONNECTED_REPOSITORY", status: "COMPLETED", commitSha: { not: null } }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { commitSha: true } }),
        db.securityTestRecord.findMany({ where: { userId, repositoryFullName: connection.repository.fullName, source: "MANUAL", analysisRun: { requestedByUserId: userId, repositoryId: connection.repositoryId } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
      ]);
      const summary = summarizeManualRecords(JSON.parse(JSON.stringify(rows)) as SavedRecord[], { connectionId: id, repository: connection.repository.fullName, environmentVersion: connection.deploymentVersion, site: connection.vercelUrl });
      const current = summary.records.filter(record => record.row.commitSha === analysis?.commitSha && record.currentEnvironment);
      const progress = summaryProgress(current), latest = current[0];
      return { recorded: progress.recorded, card: <article key={id} className={styles.card} aria-label={`${connection.repository.fullName} 검토 결과`}>{heading}
        <div className={styles.progressLabel}><span>수동 관찰 기록</span><strong>{progress.recorded}/4 · {progress.percent}%</strong></div>
        <div className={styles.track} role="progressbar" aria-label={`${connection.repository.fullName} 현재 버전 수동 기록 진행률`} aria-valuemin={0} aria-valuemax={4} aria-valuenow={progress.recorded}><span style={{ width: `${progress.percent}%` }} /></div>
        <dl className={styles.statuses}>{reviewKinds.map(kind => { const outcome = progress.latest[kind]?.outcome ?? "UNSET"; return <div key={kind}><dt>{securityRecordLabels[kind]}</dt><dd className={`${styles.badge} ${styles[outcome]}`}>{summaryLabels[outcome]}</dd></div>; })}</dl>
        {summary.records.length > current.length && <p className={styles.note}>이전 분석·별도 범위 기록 {summary.records.length - current.length}개는 상세 결과에서 확인할 수 있습니다.</p>}
        {summary.excluded > 0 && <p className={styles.note}>형식·민감정보 검증으로 요약에서 제외한 기록이 있습니다. 기존 DB 기록은 유지됩니다.</p>}
        <footer className={styles.cardFooter}><div className={styles.meta}><span title={analysis?.commitSha ?? undefined}><GitCommitHorizontal size={17} aria-hidden="true" /><code>{analysis?.commitSha?.slice(0, 7) ?? "분석 없음"}</code></span><span>{latest ? <time dateTime={latest.row.updatedAt} title="현재 분석 버전의 최근 기록">{new Date(latest.row.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time> : "현재 버전 기록 없음"}</span></div>
        <Link className={styles.button} href={`/services/${encodeURIComponent(id)}/review`}>종합 검토 결과 보기 <ArrowRight size={18} aria-hidden="true" /></Link></footer>
      </article> };
    } catch {
      return { recorded: null, card: <article key={id} className={styles.card}>{heading}<p role="alert">검토 기록 조회 실패 · 진행률과 상태를 확인할 수 없습니다. 미기록으로 처리하지 않았습니다.</p><Link className={styles.button} href={`/services/${encodeURIComponent(id)}/review`}>종합 검토 결과 보기 <ArrowRight size={18} aria-hidden="true" /></Link></article> };
    }
  }));
  const visible = services.filter(service => service !== null);
  const incomplete = visible.some(service => service.recorded === null) || visible.length < connections.length;
  return <PlatformShell><main id="main-content" className="vl-main"><div className={styles.surface}>
    <header className={styles.heading}><span>SERVICE REVIEW RESULTS</span><h1>검증 결과</h1><p>서비스별 검토 결과와 이전 기록을 관리합니다.</p></header>
    <section className={styles.summary} aria-label="검토 기록 요약">
      <div><Layers size={21} aria-hidden="true" /><span>연결된 서비스</span><strong>{connections.length}</strong></div>
      <div><ClipboardList size={21} aria-hidden="true" /><span>기록 진행 서비스</span><strong>{visible.filter(service => (service.recorded ?? 0) > 0).length}{incomplete && <small> 확인된 범위</small>}</strong></div>
      <div><FileCheck2 size={21} aria-hidden="true" /><span>현재 버전 기록</span><strong>{visible.reduce((sum, service) => sum + (service.recorded ?? 0), 0)}{incomplete && <small> 확인된 범위</small>}</strong></div>
    </section>
    <div className={styles.sectionHeading}><h2>서비스별 검토 결과</h2><span>표시 {visible.length}개 서비스</span></div>
    {visible.length < connections.length && <p role="alert">일부 서비스의 현재 저장소 권한을 확인하지 못해 표시하지 않았습니다. 내 웹서비스에서 연결·권한 상태를 확인하세요. 저장된 기록은 삭제하지 않았습니다.</p>}
    {!connections.length && <section className="vl-card"><h2>연결된 서비스가 없습니다.</h2><p>내 웹서비스에서 GitHub 저장소를 연결하면 서비스별 결과를 확인할 수 있습니다. 기존 개별 기록과 DB 데이터는 유지됩니다.</p></section>}
    <section aria-label="서비스별 검토 결과" className={styles.grid}>{visible.map(service => service.card)}</section>
    <p className={styles.disclaimer}><Info size={17} aria-hidden="true" />수동 관찰 기록은 정적 분석 결과와 구분됩니다. 진행률은 실제 보안 검증 완료나 사이트 전체의 안전성을 뜻하지 않습니다.</p>
  </div></main></PlatformShell>;
}
