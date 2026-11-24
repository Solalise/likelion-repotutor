import { connectionReadiness, type VercelConnectionSummary } from "@/lib/security-lab/connectionReadiness";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import type { DeploymentCommitComparison } from "@/lib/security-lab/deploymentCommit";
import { deploymentCommitLabels } from "@/lib/security-lab/deploymentCommit";

export function ConnectionReadiness({ connectionId, snapshot, account, comparison }: { connectionId: string; snapshot?: DeploymentConnectionSnapshot; account?: VercelConnectionSummary; comparison?: DeploymentCommitComparison }) {
  const state = connectionReadiness(connectionId, snapshot, account, comparison);
  return <section aria-label="통합 실습 준비 체크리스트">
    <h3>내 사이트 실습 준비 체크리스트</h3>
    <p role="status">{state.connectionReady ? "연결 조건 확인 완료 · 실제 실행은 별도 승인 필요" : "연결 조건 확인 필요"} · 실제 요청 허용: 아니요</p>
    <p>분석 커밋: <code>{state.analyzedCommitSha ?? "미확인"}</code><br/>배포 커밋: <code>{state.deployedCommitSha ?? "미확인"}</code></p>
    <p>{deploymentCommitLabels[state.comparison?.status ?? "UNAVAILABLE"]}</p>
    {state.comparison?.checkedAt && <p>조회 시각: <time dateTime={state.comparison.checkedAt}>{new Date(state.comparison.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time> · 재배포·연결 변경 뒤에는 다시 확인하세요.</p>}
    <ol>{state.checks.map(check => <li key={check.id}><strong>{check.confirmed ? "✓ 충족" : "○ 미충족 / 미확인"} · {check.label}</strong><p>{check.detail}</p>{!check.confirmed && <p>다음 행동: {check.nextAction}</p>}</li>)}</ol>
  </section>;
}
