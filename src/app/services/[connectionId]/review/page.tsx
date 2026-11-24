import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { requireRepositoryAccess, RepositoryAccessError } from "@/lib/github/repositoryAccess";
import { getGithubAnalysisCache, githubAnalysisCacheKey } from "@/lib/repository/githubAnalysisCache";
import { summarizeManualRecords, summaryProgress } from "@/lib/results/reviewSummary";
import type { SavedRecord } from "@/components/results/RecordPersistence";
import { ReviewSummarySection } from "@/components/results/ReviewSummary";
import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import styles from "../../services.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "내 웹서비스 종합 검토 결과" };
export default async function Page({ params, searchParams }: { params: Promise<{ connectionId: string }>; searchParams: Promise<{ commit?: string }> }) {
  const userId = await currentUserId(); if (!userId) redirect("/login");
  const { connectionId } = await params, { commit } = await searchParams;
  let connection;
  try { connection = await requireRepositoryAccess(userId, connectionId); }
  catch (error) {
    if (error instanceof RepositoryAccessError && error.status === 404) notFound();
    return <PlatformShell><main className="vl-main"><h1>종합 검토 결과</h1><p role="alert">저장소 접근 권한을 확인하지 못했습니다. 로그인과 GitHub App 권한을 확인해 주세요.</p><Link href="/services">내 웹서비스로 이동</Link></main></PlatformShell>;
  }
  let latest, rows;
  try {
    [latest, rows] = await Promise.all([
      db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, source: "CONNECTED_REPOSITORY", status: "COMPLETED", commitSha: { not: null } }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { commitSha: true } }),
      db.securityTestRecord.findMany({ where: { userId, repositoryFullName: connection.repository.fullName, source: "MANUAL", analysisRun: { requestedByUserId: userId, repositoryId: connection.repositoryId } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
    ]);
  } catch {
    return <PlatformShell><main className="vl-main"><h1>종합 검토 결과</h1><p role="alert">DB 기록을 조회하지 못했습니다. 미기록으로 처리하지 않으며 기존 데이터는 변경하지 않았습니다.</p><Link href="/services">내 웹서비스로 이동</Link></main></PlatformShell>;
  }
  const summary = summarizeManualRecords(JSON.parse(JSON.stringify(rows)) as SavedRecord[], { connectionId, repository: connection.repository.fullName, environmentVersion: connection.deploymentVersion, site: connection.vercelUrl });
  if (commit && (typeof commit !== "string" || !/^[a-f0-9]{40}$/i.test(commit) || commit !== latest?.commitSha && !summary.records.some(item => item.row.commitSha === commit))) notFound();
  const selectedCommit = commit ?? latest?.commitSha ?? summary.records[0]?.row.commitSha;
  const selected = summary.records.filter(item => item.row.commitSha === selectedCommit);
  const current = selected.filter(item => item.currentEnvironment);
  const otherEnvironments = new Map<string, typeof selected>();
  for (const item of selected.filter(item => !item.currentEnvironment)) {
    const key = item.environmentVersion === null ? "환경 버전 미확인 개별 기록" : `이전 환경 버전 ${item.environmentVersion} · ${item.site ?? "사이트 미등록"}`;
    otherEnvironments.set(key, [...(otherEnvironments.get(key) ?? []), item]);
  }
  const commits = [...new Set(summary.records.map(item => item.row.commitSha))].filter(sha => sha !== selectedCommit);
  const cached = selectedCommit ? getGithubAnalysisCache(githubAnalysisCacheKey(`installation:${connection.installation.installationId}`, connection.repository.fullName, selectedCommit)) : undefined;
  const analysis = cached?.repository === connection.repository.fullName && cached.collection?.commitSha === selectedCommit ? cached : undefined;
  const url = `/services/${encodeURIComponent(connectionId)}/review`;
  return <PlatformShell><main id="main-content" className={`vl-main ${styles.workspace}`}>
    <header className="vl-page-heading"><div><span className="vl-eyebrow">MANUAL REVIEW SUMMARY</span><h1>종합 검토 결과</h1><p>{connection.repository.fullName}</p></div></header>
    <div className="vl-actions"><Link className="vl-outline-button" href={`/services?connected=${encodeURIComponent(connectionId)}`}>내 웹서비스</Link><Link className="vl-outline-button" href="/results">기존 저장 기록 목록</Link></div>
    <section className="vl-card"><p>최근 완료된 분석 커밋: <code>{latest?.commitSha ?? "없음"}</code></p><p>조회 중인 커밋: <code>{selectedCommit ?? "없음"}</code> · {selectedCommit && selectedCommit === latest?.commitSha ? "현재 분석 기록" : "이전 분석 기록"}</p>
      <p>아래 진행률은 DB에 수동 판정이 저장된 유형 수입니다. 실제 보안 검증 완료나 사이트 전체의 안전성을 뜻하지 않습니다. 문제 미관찰도 확인한 범위의 사용자 관찰일 뿐입니다.</p>
      <p>현재 등록 환경 버전 {connection.deploymentVersion} · {connection.vercelUrl ?? "사이트 미등록"}. 다른 환경 버전의 기록은 별도로 표시하며 현재 결과로 승계하지 않습니다.</p>
      {!latest && <p>현재 연결에서 완료된 분석 커밋을 찾지 못했습니다. 저장된 이전 기록이 있다면 별도로 조회할 수 있습니다.</p>}
    </section>
    <ReviewSummarySection title={selectedCommit === latest?.commitSha ? "현재 분석 · 현재 등록 환경" : "선택한 이전 분석 · 현재 등록 환경 기준"} records={current} analysis={analysis} showStatic/>
    {[...otherEnvironments].map(([title, records]) => <details className="vl-card" key={title}><summary>{title} · 별도 보존 ({summaryProgress(records).recorded}/4)</summary><p>위 현재 등록 환경의 진행률에는 합산하지 않습니다.</p><ReviewSummarySection title={title} records={records} analysis={analysis}/></details>)}
    <section className="vl-card"><h2>다른 분석 커밋의 수동 기록</h2><p>이전 기록은 DB에 보존되며 새 분석 결과로 자동 승계되지 않습니다.</p><ul>
      {latest?.commitSha && selectedCommit !== latest.commitSha && <li><Link href={url}>현재 분석 커밋으로 돌아가기</Link></li>}
      {commits.map(sha => <li key={sha}><Link href={`${url}?commit=${encodeURIComponent(sha)}`}>{sha} · 저장 기록 {summary.records.filter(item => item.row.commitSha === sha).length}개</Link></li>)}
    </ul>{!commits.length && <p>다른 커밋에 저장된 수동 기록이 없습니다.</p>}</section>
    {summary.excluded > 0 && <p role="status">형식이나 민감정보 검증을 통과하지 못한 기록 {summary.excluded}개는 요약에 포함하지 않았습니다. DB 데이터는 변경하지 않았습니다.</p>}
  </main></PlatformShell>;
}
