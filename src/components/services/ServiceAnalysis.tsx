"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RepositoryAnalysis } from "@/types/analysis";
import { SqlInjectionFindings } from "@/components/repository/SqlInjectionFindings";
import { retainServiceAnalysis, type ServiceAnalysisSnapshot } from "@/types/serviceAnalysisSession";
import { SqliObservationHistoryProvider } from "@/components/repository/SqliObservationHistory";
import { XssObservationHistoryProvider } from "@/components/repository/XssObservationHistory";

export async function requestServiceFindings(connectionId: string, fetcher: typeof fetch = fetch): Promise<RepositoryAnalysis> {
  const response = await fetcher(`/api/repositories/${encodeURIComponent(connectionId)}/analyze`, {
    cache: "no-store", credentials: "same-origin", redirect: "error", headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("분석을 완료하지 못했습니다. GitHub 권한과 연결 상태를 확인해 주세요.");
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

export function ServiceAnalysis({ connectionId, status }: { connectionId: string; status: string }) {
  return <AnalysisSession key={connectionId} connectionId={connectionId} status={status} />;
}

function AnalysisSession({ connectionId, status }: { connectionId: string; status: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [snapshots, setSnapshots] = useState<ServiceAnalysisSnapshot[]>([]);
  const inFlight = useRef(false);
  const router = useRouter();
  return <SqliObservationHistoryProvider><XssObservationHistoryProvider><section className="vl-card" aria-labelledby="service-analysis-title">
    <h2 id="service-analysis-title">저장소 분석 결과와 실습 대상</h2>
    <p className="vl-description">1. 저장소 분석 → 2. SQLi/XSS 취약점 후보 선택 → 3. API·입력값 확인 → 4. 실습 준비. 정적 분석은 실제 취약점이나 실습 성공을 확정하지 않습니다.</p>
    <button type="button" className="vl-button" disabled={busy} onClick={async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true); setMessage("재분석 중에도 기존 결과와 기록을 읽을 수 있습니다. 편집과 실행은 잠시 차단됩니다.");
      try { const next = await requestServiceFindings(connectionId); setSnapshots(previous => retainServiceAnalysis(previous, next)); setMessage("분석이 완료되었습니다. 아래에서 취약점 후보를 선택하세요."); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "분석을 완료하지 못했습니다."); }
      finally { inFlight.current = false; setBusy(false); }
    }}>{busy ? "분석 중…" : status === "COMPLETED" ? "분석 결과 조회 · 최신 코드 재확인" : "저장소 분석 실행"}</button>
    <p role="status" className="vl-small">{message}</p>
    <p className="vl-small">작성 중인 초안은 화면 세션에 보관됩니다. DB에 저장한 수동 기록은 결과 페이지에서 다시 조회·수정할 수 있습니다. 커밋이나 후보·코드·API 연결 구조가 달라지면 이전 분석 기록으로 분리됩니다.</p>
    {[...snapshots].reverse().map((snapshot, index) => <section key={snapshot.id} aria-label={index === 0 ? "현재 분석 기록" : "이전 분석 기록"}>
      <h3>{index === 0 ? "현재 분석" : "이전 분석의 기록 · 읽기 전용"}</h3>
      <p>분석 커밋: <code>{snapshot.analysis.collection?.commitSha ?? "확인되지 않음"}</code> · 분석 화면 #{snapshot.id}</p>
      {index !== 0 && <p>이 화면의 기록과 서버 응답은 이전 분석에만 속합니다. 현재 분석의 검증 결과가 아닙니다. 같은 SHA라도 후보 또는 분석 구조가 달라지면 별도 기록으로 보관합니다.</p>}
      <details open={index === 0}>
        <summary>{index === 0 ? "현재 분석 결과 및 기록" : "이전 분석 화면과 작성 기록 보기"}</summary>
        {/* Keep each Provider and its editor subtree mounted; disable actions without discarding drafts. */}
        <fieldset disabled={busy || index !== 0} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <SqlInjectionFindings analysis={snapshot.analysis} connectionId={connectionId} archived={index !== 0} />
        </fieldset>
      </details>
    </section>)}
  </section></XssObservationHistoryProvider></SqliObservationHistoryProvider>;
}
