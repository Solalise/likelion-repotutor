"use client";
import { useEffect, useRef, useState } from "react";
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
  const [restoreState, setRestoreState] = useState<"loading" | "loaded" | "empty" | "failed">("loading");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [analyzedAt, setAnalyzedAt] = useState<string>();
  const [commitAttempt, setCommitAttempt] = useState(0);
  const [head, setHead] = useState<{ key: string; sha?: string; branch?: string; failed?: boolean }>();
  const pendingHead = useRef<{ key: string; promise: Promise<{ sha: string; branch: string }> } | undefined>(undefined);
  const inFlight = useRef(false);
  const router = useRouter();
  const latest = snapshots.at(-1)?.analysis;
  const analyzedSha = latest?.collection?.commitSha;
  const branch = latest?.collection?.defaultBranch;
  const commitKey = JSON.stringify([connectionId, analyzedSha, branch, commitAttempt]);
  const commitState = !latest ? "idle" : head?.key !== commitKey ? "checking" : head.failed ? "failed"
    : head.sha === analyzedSha?.toLowerCase() ? "current" : "changed";

  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      try {
        const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId)}/analysis`, {
          cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? "저장된 분석 결과 조회에 실패했습니다.");
        if (controller.signal.aborted) return;
        if (data.analysis === null) {
          setRestoreState("empty"); setMessage("저장된 분석 결과가 없습니다. 최초 분석을 실행해 주세요. 이전 통계·수동 기록은 유지됩니다.");
        } else {
          const result = data.analysis as RepositoryAnalysis;
          if (result.source !== "github" || !Array.isArray(result.files) || !result.collection?.commitSha
            || (repository && result.repository !== repository)) throw new Error("저장된 분석 결과의 저장소 정보를 확인하지 못했습니다.");
          setSnapshots(previous => retainServiceAnalysis(previous, result));
          setAnalyzedAt(result.analyzedAt);
          setRestoreState("loaded"); setMessage("저장된 마지막 성공 분석 결과를 표시합니다.");
        }
      } catch (error) {
        if (!controller.signal.aborted) { setRestoreState("failed"); setMessage(error instanceof Error ? error.message : "저장된 분석 결과 조회에 실패했습니다."); }
      }
    }
    void restore();
    return () => controller.abort();
  }, [connectionId, repository, restoreAttempt]);
  useEffect(() => {
    let cancelled = false;
    if (!analyzedSha) return () => { cancelled = true; };
    // Reuse the request during Strict Mode's effect replay; ignore late responses after cleanup.
    if (pendingHead.current?.key !== commitKey) {
      const promise = (async () => {
        const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId)}/latest-commit`, {
          cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(60000),
        });
        const data = await response.json();
        if (!response.ok || !/^[a-f0-9]{40}$/i.test(data.sha) || typeof data.branch !== "string"
          || data.repository !== latest?.repository) throw new Error("COMMIT_LOOKUP_FAILED");
        return { sha: String(data.sha).toLowerCase(), branch: data.branch as string };
      })();
      pendingHead.current = { key: commitKey, promise };
    }
    void pendingHead.current.promise.then(result => {
      if (!cancelled) setHead({ key: commitKey, ...result });
    }, () => { if (!cancelled) setHead({ key: commitKey, failed: true }); });
    return () => { cancelled = true; };
  }, [connectionId, analyzedSha, commitKey, latest?.repository]);
  const name = latest?.repository ?? repository;
  const stack = [...new Set([...(latest?.technology?.frameworks ?? []), ...(latest?.technology?.databases ?? []), ...(latest?.technology?.persistence ?? [])])];
  return <SqliObservationHistoryProvider><XssObservationHistoryProvider><section className={styles.workspace} aria-labelledby="service-analysis-title">
    <header className={styles.projectHeader}><span className={styles.projectIcon}><Github size={32} aria-hidden="true" /></span><div><h2 id="service-analysis-title">{name?.split("/").at(-1) ?? "내 웹서비스"}</h2><p>{name?.split("/")[0] ?? "GitHub"} · GitHub 저장소</p></div><span className={styles.status}>{busy ? "분석 중" : latest ? "분석 완료 · 저장된 결과" : restoreState === "loading" ? "분석 결과 조회 중" : restoreState === "failed" ? "분석 결과 조회 실패" : status === "RUNNING" ? "분석 진행 중" : "미분석 · 저장된 결과 없음"}</span></header>
    {stack.length > 0 && <div className={styles.tags}>{stack.map(tech => <span key={tech}>{tech}</span>)}</div>}
    <section className={styles.panel}><div className={styles.panelHeading}><h3>프로젝트 분석 현황</h3>
    <button type="button" className={styles.secondary} disabled={busy || restoreState === "loading" || Boolean(latest && commitState !== "changed")} onClick={async () => {
      if (inFlight.current || restoreState === "loading" || (latest && commitState !== "changed")) return;
      inFlight.current = true;
      setBusy(true); setMessage("재분석 중에도 기존 결과와 기록을 읽을 수 있습니다. 편집과 실행은 잠시 차단됩니다.");
      try { const next = await requestServiceFindings(connectionId); setSnapshots(previous => retainServiceAnalysis(previous, next)); setAnalyzedAt(next.analyzedAt); setRestoreState("loaded"); setCommitAttempt(value => value + 1); setMessage("분석 결과를 저장했습니다. 아래 카드에서 유형별 분석 상태와 정적 후보를 확인하세요."); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "분석을 완료하지 못했습니다."); }
      finally { inFlight.current = false; setBusy(false); }
    }}><RefreshCw size={16} aria-hidden="true" />{busy ? "분석 중…" : latest ? commitState === "current" ? "최신 분석 상태" : commitState === "checking" ? "최신 커밋 확인 중…" : commitState === "failed" ? "최신 상태 확인 필요" : "최신 코드로 다시 분석" : "저장소 분석 실행"}</button></div>
    {latest && <p role="status" className={styles.note}>{commitState === "checking" ? "저장된 결과를 표시하며 GitHub 최신 커밋을 확인하고 있습니다…"
      : commitState === "current" ? "최신 분석 상태 · 분석 커밋과 브랜치 최신 커밋이 같습니다."
      : commitState === "changed" ? `코드 변경 감지 · ${head?.branch} 브랜치에 새 커밋 ${head?.sha?.slice(0, 7)}이 있습니다. 저장된 결과는 이전 분석 커밋 기준입니다.`
      : "최신 상태 확인 실패 · 저장된 분석 결과는 유지됩니다."}</p>}
    {latest && commitState === "failed" && <button type="button" className={styles.secondary} disabled={busy} onClick={() => setCommitAttempt(value => value + 1)}>최신 상태 다시 확인</button>}
    <div className={styles.metrics}><div><span>전체 파일</span><strong>{latest?.collection?.repositoryFiles ?? "—"}</strong></div><div><span>분석한 파일</span><strong>{latest ? latest.files.length : "—"}</strong></div><div><span>정적 의심 후보</span><strong>{latest ? reviewKinds.reduce((sum, kind) => sum + scanPresentation(latest, kind).candidates, 0) : "—"}</strong></div></div>
    <div className={styles.analysisMeta}><span><GitCommitHorizontal size={17} aria-hidden="true" />분석 커밋 <code title={latest?.collection?.commitSha}>{latest?.collection?.commitSha?.slice(0, 7) ?? "결과 조회 후 표시"}</code></span>{latest && <a href="#service-analysis-details" onClick={() => { const panel = document.getElementById("service-analysis-details"); if (panel instanceof HTMLDetailsElement) panel.open = true; }}>상세 분석 보기 →</a>}</div>
    {latest && analyzedAt && <p className={styles.note}>마지막 분석 일시: <time dateTime={analyzedAt}>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(analyzedAt))}</time> · 분석기 {latest.scannerRevision ?? "버전 정보 없음"}</p>}
    {restoreState === "loading" && !latest && <p role="status">저장된 분석 결과 조회 중…</p>}
    {restoreState === "failed" && <button type="button" className={styles.secondary} onClick={() => { setRestoreState("loading"); setRestoreAttempt(value => value + 1); }}>저장 결과 다시 조회</button>}
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
