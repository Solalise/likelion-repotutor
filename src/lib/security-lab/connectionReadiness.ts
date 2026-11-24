import type { DeploymentConnectionSnapshot } from "./findingPreparation";
import type { DeploymentCommitComparison } from "./deploymentCommit";

export type VercelConnectionSummary = {
  connectionId?: string; encryptionReady: boolean; connected?: boolean; message?: string; issue?: string | null;
  identity?: { id: string; name: string; username: string | null } | null;
  selection?: { teamId: string | null; projectId: string } | null;
  analysisCommitSha?: string | null; deploymentUrl?: string | null;
};
export type ReadinessCheck = { id: string; label: string; confirmed: boolean; detail: string; nextAction: string };

/** Display-only checklist. Never grants execution or replaces server authorization. */
export function connectionReadiness(connectionId: string, snapshot?: DeploymentConnectionSnapshot, account?: VercelConnectionSummary, comparison?: DeploymentCommitComparison) {
  const bound = snapshot?.connectionId === connectionId;
  const accountBound = bound && account?.connectionId === connectionId;
  const deployment = bound ? snapshot.deployment : undefined;
  const sha = accountBound ? account.analysisCommitSha : undefined;
  const project = accountBound ? account.selection : undefined;
  const accountValid = Boolean(accountBound && account.encryptionReady && account.connected && account.identity && !account.issue);
  const evidence = Boolean(bound && accountBound && comparison && ["MATCH", "MISMATCH"].includes(comparison.status)
    && comparison.connectionId === connectionId && comparison.repository.toLowerCase() === snapshot.repository.fullName.toLowerCase()
    && comparison.deploymentVersion === snapshot.deploymentVersion && comparison.deploymentUrl === deployment?.vercelUrl
    && account.deploymentUrl === deployment?.vercelUrl && comparison.analyzedCommitSha === sha
    && comparison.projectId === project?.projectId && comparison.source === "VERCEL_API"
    && comparison.analysisRunId && comparison.deploymentId && /^[0-9a-f]{40}$/i.test(comparison.deployedCommitSha ?? ""));
  const match = evidence && comparison?.status === "MATCH" && comparison.deployedCommitSha?.toLowerCase() === sha?.toLowerCase();
  let currentComparison = comparison && accountBound && bound && comparison.connectionId === connectionId
    && comparison.repository.toLowerCase() === snapshot.repository.fullName.toLowerCase()
    && comparison.deploymentUrl === deployment?.vercelUrl && comparison.deploymentVersion === snapshot.deploymentVersion
    && comparison.analyzedCommitSha === sha ? comparison : undefined;
  if (currentComparison && ["MATCH", "MISMATCH"].includes(currentComparison.status)
    && (!evidence || currentComparison.status === "MATCH" && !match)) currentComparison = undefined;
  const checks: ReadinessCheck[] = [
    { id: "repository", label: "GitHub 저장소 연결", confirmed: Boolean(bound), detail: bound ? snapshot.repository.fullName : "권한 확인된 저장소 연결 정보를 조회하지 못했습니다.", nextAction: "서비스를 선택하고 연결 상태를 새로고침하세요. 권한 오류가 있으면 GitHub App 접근을 확인하세요." },
    { id: "account", label: "Vercel 계정", confirmed: accountValid, detail: accountValid ? account!.identity!.name : account?.issue ?? account?.message ?? "Vercel 계정 또는 현재 인증을 확인하지 못했습니다.", nextAction: account?.connected ? "계정 관리에서 토큰 상태·만료·접근 권한을 확인하세요. 정상 연결은 다시 등록할 필요가 없습니다." : "계정 관리에서 Vercel 계정을 연결하세요." },
    { id: "project", label: "Vercel 프로젝트 선택", confirmed: Boolean(accountValid && project), detail: project ? `${project.teamId ?? "개인 계정"} / ${project.projectId} · 저장된 선택` : "저장된 프로젝트 선택이 없습니다.", nextAction: "프로젝트 관리에서 GitHub 저장소에 대응하는 프로젝트를 선택하세요. 이미 선택했다면 상태만 새로고침하세요." },
    { id: "url", label: "배포 URL", confirmed: Boolean(deployment?.vercelUrl), detail: deployment?.vercelUrl ?? "배포 URL 미등록", nextAction: "배포 URL 관리에서 테스트 배포의 HTTPS 주소를 저장하세요." },
    { id: "ownership", label: "사이트 소유권", confirmed: Boolean(deployment?.ownershipStatus === "VERIFIED" && deployment.verifiedAt), detail: deployment?.ownershipStatus === "VERIFIED" && deployment.verifiedAt ? "저장된 소유권 검증 기록 있음" : "소유권 미검증 또는 확인 정보 없음", nextAction: "소유권 관리에서 검증 파일을 배치하고 확인하세요. 완료된 소유권은 다시 발급할 필요가 없습니다." },
    { id: "analysis", label: "분석 커밋", confirmed: Boolean(sha && /^[0-9a-f]{40}$/i.test(sha)), detail: sha ?? "완료된 연결 저장소 분석이 없습니다.", nextAction: "선택한 저장소를 분석한 뒤 연결 상태를 새로고침하세요." },
    { id: "binding", label: "저장소·프로젝트·배포 URL 대응", confirmed: Boolean(accountValid && evidence), detail: evidence ? `공식 API 확인 · ${comparison!.projectId} / ${comparison!.deploymentId}` : "저장된 프로젝트 선택만으로 현재 URL의 배포 대응을 확정하지 않습니다.", nextAction: "배포 커밋 확인을 누르세요. 실패 이유에 따라 계정·팀 범위, 저장소 ID와 URL의 프로젝트를 확인하세요." },
    { id: "commit", label: "분석 커밋 = 배포 커밋", confirmed: Boolean(accountValid && match), detail: currentComparison?.reason ?? "공식 배포 커밋을 아직 확인하지 않았거나 연결 변경으로 이전 결과가 무효입니다.", nextAction: evidence && comparison?.status === "MISMATCH" ? "분석은 기본 브랜치 최신 커밋을 사용합니다. 배포 브랜치·커밋을 확인하고 기본 브랜치 재분석 또는 분석 SHA 재배포 후 다시 비교하세요." : "계정·프로젝트·URL·분석 기록을 확인한 뒤 배포 커밋 확인을 누르세요." },
    { id: "execution", label: "격리 환경·명시적 대상·별도 실행 승인·요청 제한", confirmed: false, detail: "이 화면은 실행 대상·격리 환경·실행 승인·요청 예산을 부여하거나 검증하지 않습니다. 실제 요청은 허용하지 않습니다.", nextAction: "연결 확인 결과만 검토하세요. 실제 실행 환경과 서버 승인은 후속 단계의 별도 조건이며, 재등록으로 해제되지 않습니다." },
  ];
  return { checks, connectionReady: checks.filter(c => c.id !== "execution").every(c => c.confirmed), canExecute: false as const,
    comparison: currentComparison, analyzedCommitSha: sha ?? null, deployedCommitSha: evidence ? comparison!.deployedCommitSha : null };
}
