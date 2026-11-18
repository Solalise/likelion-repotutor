"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { SqlInjectionFinding, XssFinding } from "@/types/security";
import { findingPreparation, type DeploymentConnectionSnapshot, type PreparationState } from "@/lib/security-lab/findingPreparation";
import { deploymentCommitLabels, type DeploymentCommitComparison } from "@/lib/security-lab/deploymentCommit";
import { subscribeVercelChanged } from "@/lib/vercel/connectionEvents";
import { PracticeTargetEditor } from "./PracticeTargetEditor";

const labels: Record<PreparationState, string> = {
  DEPLOYMENT_MISSING: "배포 URL 미등록", OWNERSHIP_UNVERIFIED: "소유권 미검증",
  COMMIT_UNCONFIRMED: "배포 코드 일치 여부 미확인", TARGET_UNCONFIRMED: "실습 대상 경로 미확인",
  COMMIT_MISMATCH: "배포 커밋과 분석 커밋 불일치",
  READY: "실습 준비 완료", RESULT_CONFIRMED: "실습 결과 확인 완료",
};

type Props = {
  analysis: RepositoryAnalysis; finding: SqlInjectionFinding | XssFinding; connectionId?: string;
};

export function FindingPreparation(props: Props) {
  return <Preparation key={JSON.stringify([props.connectionId, props.analysis.repository, props.analysis.collection?.commitSha])} {...props} />;
}

function Preparation({ analysis, finding, connectionId }: Props) {
  const [snapshot, setSnapshot] = useState<DeploymentConnectionSnapshot>();
  const [loading, setLoading] = useState(Boolean(connectionId));
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [comparison, setComparison] = useState<DeploymentCommitComparison>();
  const [checkingCommit, setCheckingCommit] = useState(false);
  const commitController = useRef<AbortController | null>(null);
  const refreshDeployment = useCallback(() => {
    commitController.current?.abort(); setComparison(undefined); setSnapshot(undefined);
    setCheckedAt(undefined); setError(""); setCheckingCommit(false);
    setLoading(Boolean(connectionId)); setRefresh(value => value + 1);
  }, [connectionId]);
  useEffect(() => subscribeVercelChanged(refreshDeployment), [refreshDeployment]);

  useEffect(() => {
    const controller = new AbortController();
    if (!connectionId) return () => controller.abort();
    async function load() {
      try {
        // Existing authenticated metadata API only. Never fetch the deployment URL.
        const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId!)}/deployment`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message ?? "배포 연결 상태를 확인하지 못했습니다.");
        }
        const payload = await response.json() as DeploymentConnectionSnapshot;
        if (payload.connectionId !== connectionId || payload.repository.fullName.toLowerCase() !== analysis.repository.toLowerCase()) {
          throw new Error("분석 저장소와 배포 연결 저장소가 일치하지 않습니다.");
        }
        if (!controller.signal.aborted) {
          setSnapshot(payload);
          setCheckedAt(new Date().toISOString());
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "배포 정보 조회에 실패했습니다.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); commitController.current?.abort(); };
  }, [connectionId, analysis.repository, analysis.collection?.commitSha, refresh]);

  async function checkCommit() {
    const sha = analysis.collection?.commitSha;
    if (!connectionId || !snapshot?.deployment.vercelUrl || !sha || checkingCommit || loading) return;
    const controller = new AbortController();
    commitController.current?.abort();
    commitController.current = controller;
    setComparison(undefined);
    setCheckingCommit(true);
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId)}/deployment/commit`, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisCommitSha: sha }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? "배포 정보 조회에 실패했습니다.");
      }
      const payload = await response.json() as DeploymentCommitComparison;
      if (payload.connectionId !== connectionId || payload.repository.toLowerCase() !== analysis.repository.toLowerCase()
        || payload.deploymentUrl !== snapshot.deployment.vercelUrl || payload.deploymentVersion !== snapshot.deploymentVersion) {
        throw new Error("조회 중 배포 연결이 변경되었습니다. 배포 연결 상태를 새로고침해 주세요.");
      }
      if (!controller.signal.aborted) setComparison(payload);
    } catch (reason) {
      if (!controller.signal.aborted) setComparison({
        status: "LOOKUP_FAILED", reason: reason instanceof Error ? reason.message : "배포 정보 조회 실패",
        connectionId, repository: analysis.repository, analysisRunId: null, analyzedCommitSha: sha,
        deployedCommitSha: null, deploymentUrl: snapshot.deployment.vercelUrl,
        deploymentVersion: snapshot.deploymentVersion, deploymentId: null, projectId: null, source: null,
        checkedAt: new Date().toISOString(),
      });
    } finally { if (!controller.signal.aborted) setCheckingCommit(false); }
  }

  const preparation = findingPreparation(analysis, finding, connectionId, snapshot, comparison);
  const topic = finding.type === "XSS" ? "xss" : "sqli";
  return <section aria-labelledby="finding-preparation-title" aria-busy={loading || checkingCommit}>
    <h4 id="finding-preparation-title">사용자 프로젝트 재현 실습 준비</h4>
    <p>정적 탐지 후보와 배포 환경을 연결해 준비 조건을 표시합니다. 커밋 확인은 공식 메타데이터만 조회합니다. SQLi 전송은 별도 서버 등록 대상·실행 승인·요청 예산을 편집기에서 확인한 뒤에만 가능합니다.</p>
    <PracticeTargetEditor key={JSON.stringify([finding.id, snapshot?.deploymentVersion, snapshot?.deployment.vercelUrl, snapshot?.deployment.ownershipStatus])}
      analysis={analysis} finding={finding} baseUrl={preparation.deployment?.vercelUrl} connectionId={connectionId}
      ownership={preparation.deployment?.ownershipStatus === "VERIFIED" && Boolean(preparation.deployment?.verifiedAt)} />
    <dl className="repository-metadata">
      <div><dt>저장소 / 분석 커밋</dt><dd>{preparation.staticFinding.repository} / <code>{preparation.staticFinding.commitSha ?? "미확인"}</code></dd></div>
      <div><dt>후보 / 코드 위치</dt><dd>{finding.type} · {finding.filePath}:{finding.line}</dd></div>
      <div><dt>입력 출처</dt><dd>{preparation.staticFinding.inputSources.length ? preparation.staticFinding.inputSources.map((source, index) => <p key={index}>{source.description} · {source.filePath}:{source.line}</p>) : "정적 분석에서 출처 미확정"}</dd></div>
      <div><dt>위험 지점</dt><dd><code>{finding.sink}</code></dd></div>
      <div><dt>연결된 Vercel URL</dt><dd>{preparation.deployment ? preparation.deployment.vercelUrl ?? "미등록" : "조회되지 않음"}</dd></div>
      <div><dt>소유권</dt><dd>{!preparation.deployment ? "조회되지 않음" : preparation.deployment.ownershipStatus === "VERIFIED" && preparation.deployment.verifiedAt ? "저장된 검증 기록 있음" : "미검증"}</dd></div>
      <div><dt>GitHub 분석 커밋 SHA</dt><dd><code>{analysis.collection?.commitSha ?? "미확인"}</code></dd></div>
      <div><dt>Vercel 배포 커밋 SHA</dt><dd><code>{preparation.deploymentCodeMatch?.deployedCommitSha ?? "확인되지 않음"}</code></dd></div>
      <div><dt>커밋 일치 여부</dt><dd>{checkingCommit ? "공식 메타데이터 확인 중" : deploymentCommitLabels[preparation.deploymentCodeMatch?.status ?? "UNAVAILABLE"]}</dd></div>
      <div><dt>실습 준비 상태</dt><dd>{loading ? "연결 정보 확인 중" : preparation.state ? labels[preparation.state] : "배포 연결 정보 미확인"}</dd></div>
      <div><dt>실제 재현 가능 여부</dt><dd>이 연결 정보는 실행 승인이 아닙니다. SQLi 편집기의 별도 서버 승인 상태를 확인하세요.</dd></div>
      <div><dt>실습 대상 URL·API 경로</dt><dd>상단 대상 확인 화면에서 지정 · 실행 권한과 별도</dd></div>
      <div><dt>실습 결과</dt><dd>실제 전송 결과는 SQLi 편집기에서 별도 표시합니다.</dd></div>
    </dl>
    {connectionId && <>
      <button className="secondary-action" type="button" disabled={loading || checkingCommit} onClick={refreshDeployment}>배포 연결 상태 새로고침</button>
      <button className="secondary-action" type="button" disabled={loading || checkingCommit || !snapshot?.deployment.vercelUrl || !analysis.collection?.commitSha} onClick={() => void checkCommit()}>{checkingCommit ? "커밋 확인 중…" : "배포 커밋 확인"}</button>
    </>}
    <p>{preparation.deploymentCodeMatch?.reason ?? "공식 배포 커밋을 아직 확인하지 않았습니다. 사용자별 Vercel 인증과 프로젝트 접근 권한이 없으면 확인 불가로 표시합니다."}</p>
    {preparation.deploymentCodeMatch?.checkedAt && <p>커밋 조회 시각: <time dateTime={preparation.deploymentCodeMatch.checkedAt}>{new Date(preparation.deploymentCodeMatch.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time>. 이후 재배포나 alias 변경 시 다시 확인해야 합니다.</p>}
    {preparation.deploymentCodeMatch?.status === "MISMATCH" && <p className="notice-error">현재 배포된 커밋으로 저장소를 다시 분석하거나, 분석했던 커밋을 Vercel에 재배포한 뒤 다시 확인하세요.</p>}
    {checkedAt && <p>마지막 조회: <time dateTime={checkedAt}>{new Date(checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time>. URL 저장·소유권 확인 후 새로고침하세요. 표시 정보는 실행 권한이 아닙니다.</p>}
    {error && <p className="notice-error" role="alert">{error} URL 미등록으로 단정하지 않고 모든 실행을 차단합니다.</p>}
    <details>
      <summary>서버 실행 승인에 필요한 준비 조건 (화면 입력과 별도)</summary>
      <ul>{preparation.checks.map(check => <li key={check.id}><strong>{check.label}: {check.status === "CONFIRMED" ? "확인 기록 있음" : check.status === "BLOCKED" ? "차단 / 미완료" : "미확인 / 미완료"}</strong><p>{check.detail}</p></li>)}</ul>
    </details>
    <h4>현재 진행할 수 없는 이유</h4>
    <p>위에서 확인한 대상은 화면의 임시 초안입니다. 아래 대상 미확정 상태는 서버에서 승인된 실행 대상이 아직 없음을 뜻합니다.</p>
    <ul>{preparation.blockReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <p>소유권 확인만으로 실습을 승인하지 않습니다. 비운영 테스트 환경, 배포 커밋 일치, 명시적 대상과 제한 정책을 확인한 뒤 별도 승인된 실행 환경이 필요합니다. 재현 결과는 정적 분석과 분리해 관리해야 합니다.</p>
    <nav className="header-actions" aria-label="관련 기초 학습 및 실습">
      <Link className="secondary-action" href={`/learn/${topic}`}>개념 학습하기</Link>
      <Link className="secondary-action" href={`/practice#${topic}`}>기초 실습 선택하기</Link>
      {!connectionId ? <Link className="secondary-action" href="/repositories">내 저장소 연결하기</Link> : <a className="secondary-action" href="#repository-deployment-title">배포 URL·소유권 관리</a>}
    </nav>
  </section>;
}
