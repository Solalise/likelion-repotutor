"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RepositoryAnalysis } from "@/types/analysis";
import { SqlInjectionFindings } from "@/components/repository/SqlInjectionFindings";
import { retainServiceAnalysis, type ServiceAnalysisSnapshot } from "@/types/serviceAnalysisSession";
import { SqliObservationHistoryProvider } from "@/components/repository/SqliObservationHistory";
import { XssObservationHistoryProvider } from "@/components/repository/XssObservationHistory";
import { ProjectSecurityReview } from "./ProjectSecurityReview";
import { Github, RefreshCw, GitCommitHorizontal } from "lucide-react";
import { reviewKinds } from "@/lib/security-lab/projectReview";
import { scanPresentation } from "@/lib/repository/scanPresentation";
import styles from "./ServiceDetail.module.css";

export async function requestServiceFindings(connectionId: string, fetcher: typeof fetch = fetch): Promise<RepositoryAnalysis> {
  const response = await fetcher(`/api/repositories/${encodeURIComponent(connectionId)}/analyze`, {
    cache: "no-store", credentials: "same-origin", redirect: "error", headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? "분석을 완료하지 못했습니다. GitHub 권한과 연결 상태를 확인해 주세요.");
  }
  const result = await response.json() as RepositoryAnalysis;
  if (result.source !== "github" || !Array.isArray(result.files) || !result.collection?.commitSha) throw new Error("분석 결과를 확인하지 못했습니다.");
  return result;
}

export async function requestServiceAnalysis(connectionId: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/repositories/${encodeURIComponent(connectionId)}/analyze`, {
    cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: { Accept: "application/vnd.repotutor.analysis-receipt+json" },
  });
  if (!response.ok) throw new Error("분석을 완료하지 못했습니다. GitHub 권한과 연결 상태를 확인해 주세요.");
  const receipt = await response.json();
  if (receipt?.status !== "analysis-complete" || typeof receipt.commitSha !== "string") throw new Error("분석 완료 상태를 확인하지 못했습니다.");
  return { status: "analysis-complete" as const, commitSha: receipt.commitSha };
}

export function ServiceAnalysis({ connectionId, status, repository }: { connectionId: string; status: string; repository?: string }) {
  return <AnalysisSession key={connectionId} connectionId={connectionId} status={status} repository={repository} />;
}

function AnalysisSession({ connectionId, status, repository }: { connectionId: string; status: string; repository?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [snapshots, setSnapshots] = useState<ServiceAnalysisSnapshot[]>([]);
  const inFlight = useRef(false);
  const router = useRouter();
  const latest = snapshots.at(-1)?.analysis;
  const name = latest?.repository ?? repository;
  const stack = [...new Set([...(latest?.technology?.frameworks ?? []), ...(latest?.technology?.databases ?? []), ...(latest?.technology?.persistence ?? [])])];
  return <SqliObservationHistoryProvider><XssObservationHistoryProvider><section className={styles.workspace} aria-labelledby="service-analysis-title">
    <header className={styles.projectHeader}><span className={styles.projectIcon}><Github size={32} aria-hidden="true" /></span><div><h2 id="service-analysis-title">{name?.split("/").at(-1) ?? "내 웹서비스"}</h2><p>{name?.split("/")[0] ?? "GitHub"} · GitHub 저장소</p></div><span className={styles.status}>{busy ? "분석 중" : latest ? "분석 결과 조회됨" : status === "COMPLETED" ? "분석 완료 · 결과 조회 가능" : status === "FAILED" ? "분석 실패" : status === "RUNNING" ? "분석 진행 중" : "분석 전"}</span></header>
    {stack.length > 0 && <div className={styles.tags}>{stack.map(tech => <span key={tech}>{tech}</span>)}</div>}
    <section className={styles.panel}><div className={styles.panelHeading}><h3>프로젝트 분석 현황</h3>
    <button type="button" className={styles.secondary} disabled={busy} onClick={async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true); setMessage("재분석 중에도 기존 결과와 기록을 읽을 수 있습니다. 편집과 실행은 잠시 차단됩니다.");
      try { const next = await requestServiceFindings(connectionId); setSnapshots(previous => retainServiceAnalysis(previous, next)); setMessage("분석 결과를 받았습니다. 아래 카드에서 유형별 완료·일부 완료·실패·미지원 상태와 정적 후보를 확인하세요."); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "분석을 완료하지 못했습니다."); }
      finally { inFlight.current = false; setBusy(false); }
    }}><RefreshCw size={16} aria-hidden="true" />{busy ? "분석 중…" : latest ? "다시 분석" : status === "COMPLETED" ? "분석 결과 조회 · 최신 코드 재확인" : "저장소 분석 실행"}</button></div>
    <div className={styles.metrics}><div><span>전체 파일</span><strong>{latest?.collection?.repositoryFiles ?? "—"}</strong></div><div><span>분석한 파일</span><strong>{latest ? latest.files.length : "—"}</strong></div><div><span>정적 의심 후보</span><strong>{latest ? reviewKinds.reduce((sum, kind) => sum + scanPresentation(latest, kind).candidates, 0) : "—"}</strong></div></div>
    <div className={styles.analysisMeta}><span><GitCommitHorizontal size={17} aria-hidden="true" />분석 커밋 <code title={latest?.collection?.commitSha}>{latest?.collection?.commitSha?.slice(0, 7) ?? "결과 조회 후 표시"}</code></span>{latest && <a href="#service-analysis-details" onClick={() => { const panel = document.getElementById("service-analysis-details"); if (panel instanceof HTMLDetailsElement) panel.open = true; }}>상세 분석 보기 →</a>}</div>
    <p role="status" className="vl-small">{message}</p>
    <p className={styles.note}>정적 후보가 없더라도 취약점이 없다는 의미는 아닙니다.</p></section>
    {[...snapshots].reverse().map((snapshot, index) => <section key={snapshot.id} aria-label={index === 0 ? "현재 분석 기록" : "이전 분석 기록"}>
      {index !== 0 && <><h3>이전 분석의 기록 · 읽기 전용</h3><p>분석 커밋: <code title={snapshot.analysis.collection?.commitSha}>{snapshot.analysis.collection?.commitSha?.slice(0, 7) ?? "확인되지 않음"}</code> · 분석 화면 #{snapshot.id}</p></>}
      {index !== 0 && <p>이 화면의 기록과 서버 응답은 이전 분석에만 속합니다. 현재 분석의 검증 결과가 아닙니다. 같은 SHA라도 후보 또는 분석 구조가 달라지면 별도 기록으로 보관합니다.</p>}
      <fieldset disabled={busy || index !== 0} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <ProjectSecurityReview id={index === 0 ? "project-security-review" : undefined} analysis={snapshot.analysis} connectionId={connectionId} archived={index !== 0} />
      </fieldset>
      <details id={index === 0 ? "service-analysis-details" : undefined} className={styles.panel}>
        <summary>{index === 0 ? "현재 분석 결과 및 기록" : "이전 분석 화면과 작성 기록 보기"}</summary>
        {/* Keep each Provider and its editor subtree mounted; disable actions without discarding drafts. */}
        <fieldset disabled={busy || index !== 0} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <SqlInjectionFindings analysis={snapshot.analysis} connectionId={connectionId} archived={index !== 0} />
        </fieldset>
      </details>
    </section>)}
  </section></XssObservationHistoryProvider></SqliObservationHistoryProvider>;
}
