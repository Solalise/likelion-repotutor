"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RepositoryAnalysis } from "@/types/analysis";
import { SqlInjectionFindings } from "@/components/repository/SqlInjectionFindings";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState<RepositoryAnalysis>();
  const router = useRouter();
  return <section className="vl-card" aria-labelledby="service-analysis-title">
    <h2 id="service-analysis-title">저장소 분석 결과와 실습 대상</h2>
    <p className="vl-description">1. 저장소 분석 → 2. SQLi/XSS 취약점 후보 선택 → 3. API·입력값 확인 → 4. 실습 준비. 정적 분석은 실제 취약점이나 실습 성공을 확정하지 않습니다.</p>
    <button type="button" className="vl-button" disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true); setMessage(""); setAnalysis(undefined);
      try { setAnalysis(await requestServiceFindings(connectionId)); setMessage("분석이 완료되었습니다. 아래에서 취약점 후보를 선택하세요."); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "분석을 완료하지 못했습니다."); }
      finally { setBusy(false); }
    }}>{busy ? "분석 중…" : status === "COMPLETED" ? "분석 결과 조회 · 최신 코드 재확인" : "저장소 분석 실행"}</button>
    <p role="status" className="vl-small">{message}</p>
    {analysis && !busy && <SqlInjectionFindings key={analysis.collection?.commitSha} analysis={analysis} connectionId={connectionId} />}
  </section>;
}
