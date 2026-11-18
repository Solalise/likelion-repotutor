import type { RepositoryAnalysis } from "@/types/analysis";
import type { SqlInjectionFinding, XssFinding } from "@/types/security";
import type { RepositoryDeployment } from "@/lib/repository/deployment";
import type { DeploymentCommitComparison } from "./deploymentCommit";

export type DeploymentConnectionSnapshot = {
  connectionId: string;
  deploymentVersion: number;
  repository: { fullName: string; htmlUrl: string };
  deployment: RepositoryDeployment;
};

export type PreparationState = "DEPLOYMENT_MISSING" | "OWNERSHIP_UNVERIFIED"
  | "COMMIT_UNCONFIRMED" | "COMMIT_MISMATCH" | "TARGET_UNCONFIRMED" | "READY" | "RESULT_CONFIRMED";
export type PreparationCheck = {
  id: string;
  label: string;
  status: "CONFIRMED" | "UNCONFIRMED" | "BLOCKED";
  detail: string;
};

/** A display-only projection. Never use this client model as execution authorization. */
export function findingPreparation(
  analysis: RepositoryAnalysis,
  finding: SqlInjectionFinding | XssFinding,
  connectionId: string | undefined,
  snapshot: DeploymentConnectionSnapshot | undefined,
  comparison?: DeploymentCommitComparison,
) {
  const bound = Boolean(connectionId && snapshot?.connectionId === connectionId
    && snapshot.repository.fullName.toLowerCase() === analysis.repository.toLowerCase());
  const deployment = bound ? snapshot!.deployment : undefined;
  const registered = Boolean(deployment?.vercelUrl);
  const ownership = registered && deployment?.ownershipStatus === "VERIFIED" && Boolean(deployment.verifiedAt);
  const candidate = finding.type !== "XSS" || finding.disposition === "candidate";
  const commitEvidence = comparison && bound && comparison.connectionId === connectionId
    && comparison.repository.toLowerCase() === analysis.repository.toLowerCase()
    && comparison.deploymentUrl === deployment?.vercelUrl && comparison.deploymentVersion === snapshot?.deploymentVersion
    && comparison.analyzedCommitSha?.toLowerCase() === analysis.collection?.commitSha?.toLowerCase() ? comparison : undefined;
  const commitMatches = commitEvidence?.status === "MATCH" && commitEvidence.source === "VERCEL_API"
    && Boolean(commitEvidence.analysisRunId && commitEvidence.deploymentId && commitEvidence.projectId)
    && /^[0-9a-f]{40}$/i.test(commitEvidence.deployedCommitSha ?? "")
    && commitEvidence.deployedCommitSha?.toLowerCase() === analysis.collection?.commitSha?.toLowerCase();
  // No explicit target, approval or runner evidence exists in this phase.
  // READY/RESULT_CONFIRMED are reserved states and deliberately never emitted here.
  const state: PreparationState | null = !deployment ? null : !registered ? "DEPLOYMENT_MISSING"
    : !ownership ? "OWNERSHIP_UNVERIFIED" : commitMatches ? "TARGET_UNCONFIRMED"
      : commitEvidence?.status === "MISMATCH" ? "COMMIT_MISMATCH" : "COMMIT_UNCONFIRMED";
  const checks: PreparationCheck[] = [
    { id: "deployment", label: "배포 URL 등록", status: !deployment ? "UNCONFIRMED" : registered ? "CONFIRMED" : "BLOCKED",
      detail: !deployment ? "권한 확인된 연결 저장소의 최신 배포 정보를 조회해야 합니다." : registered ? "저장소 연결에 배포 URL이 등록되어 있습니다." : "배포 URL 미등록" },
    { id: "ownership", label: "배포 URL 소유권", status: ownership ? "CONFIRMED" : "UNCONFIRMED",
      detail: ownership ? "저장된 소유권 확인 기록이 있습니다. 실습 승인이나 영구 소유권 증명은 아닙니다." : "소유권 미검증 또는 확인 정보 없음" },
    { id: "commit", label: "배포 코드와 분석 커밋 일치", status: commitMatches ? "CONFIRMED" : commitEvidence?.status === "MISMATCH" ? "BLOCKED" : "UNCONFIRMED",
      detail: commitEvidence?.reason ?? "배포 커밋 확인 불가 · 공식 메타데이터를 아직 조회하지 않았거나 현재 연결과 일치하는 조회 근거가 없습니다." },
    { id: "target", label: "명시적 실습 대상 URL·API 경로", status: "UNCONFIRMED", detail: "실습 대상 경로 미확인 · 소스 파일이나 함수 이름으로 URL을 추측하지 않습니다." },
    { id: "approval", label: "테스트 환경 승인", status: "UNCONFIRMED", detail: "사용자가 소유하거나 명시적으로 승인한 비운영 테스트 환경인지 확인해야 합니다." },
    { id: "limits", label: "요청 횟수·시간·대상 범위 제한", status: "UNCONFIRMED", detail: "승인된 실행 환경과 서버 측 제한 정책이 아직 연결되지 않았습니다." },
    { id: "ready", label: "실습 준비 완료", status: "BLOCKED", detail: "필수 검증과 별도 실행 승인이 완료되지 않았습니다. 실제 재현은 비활성화되어 있습니다." },
    { id: "result", label: "실습 결과 확인 완료", status: "UNCONFIRMED", detail: "실습 미실행 · 정적 분석 결과는 재현 결과가 아닙니다." },
  ];
  const inputSources = finding.type === "XSS" ? finding.inputSources : finding.evidence.filter(item => [
    "API 진입점의 요청 입력 읽기", "API 요청 본문을 읽는 호출", "요청 입력 형태이나 진입점/프레임워크 의미는 미확정",
  ].includes(item.description));
  return {
    staticFinding: {
      connectionId: connectionId ?? null, repository: analysis.repository,
      commitSha: analysis.collection?.commitSha ?? null,
      scannerVersion: finding.type === "XSS" ? analysis.xss?.version ?? null : analysis.sqlInjection?.version ?? null,
      findingId: finding.id, type: finding.type, filePath: finding.filePath, line: finding.line,
      inputSources, sink: finding.sink, candidate,
    },
    deployment: deployment ? {
      vercelUrl: deployment.vercelUrl, ownershipStatus: deployment.ownershipStatus,
      verifiedAt: deployment.verifiedAt,
    } : null,
    metadataStatus: bound ? "AVAILABLE" as const : "UNAVAILABLE" as const,
    state, checks,
    blockReasons: [
      ...(!candidate ? ["이 항목은 안전 처리 관찰이며 취약점 재현 대상으로 지정되지 않았습니다."] : []),
      ...(!connectionId ? ["공개 저장소 분석만으로 배포 환경을 연결할 수 없습니다. 내 저장소에서 연결한 저장소를 선택하세요."] : []),
      ...(!analysis.collection?.commitSha ? ["분석 커밋 SHA를 확인하지 못했습니다."] : []),
      ...checks.filter(check => check.status !== "CONFIRMED" && check.id !== "result").map(check => check.detail),
    ],
    canReproduce: false as const,
    // Future server-authenticated evidence must be bound to this connection, URL,
    // analysis SHA and finding ID. Neither free-form UI state nor static facts qualify.
    deploymentCodeMatch: commitEvidence ?? null,
    explicitTarget: { status: "UNCONFIRMED" as const, url: null, apiPath: null, method: null },
    authorization: { status: "UNCONFIRMED" as const, environment: null, approvalId: null },
    executionPolicy: { status: "UNCONFIGURED" as const, runnerId: null, maxRequests: null, timeoutMs: null, allowedOrigin: null, allowedPaths: [] as string[] },
    // A future result record belongs to an approved run, separate from AnalysisRun.stats.
    practiceResult: { status: "NOT_RUN" as const, runId: null, resultId: null },
  };
}
