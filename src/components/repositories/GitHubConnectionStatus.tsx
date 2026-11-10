import Link from "next/link";
import { ChevronDown, Github, RefreshCw } from "lucide-react";

type Installation = { id: string; accountLogin: string; suspendedAt: Date | null; lastSyncedAt: Date | null };

export function GitHubConnectionStatus({ installations, repositoryCount, refreshAction }: {
  installations: Installation[];
  repositoryCount: number;
  refreshAction: () => Promise<void>;
}) {
  const suspended = installations.some(item => item.suspendedAt);
  const needsAttention = !installations.length || suspended || !repositoryCount;
  const accountNames = [...new Set(installations.map(item => item.accountLogin))];
  const accounts = accountNames.length > 1 ? `${accountNames[0]} 외 ${accountNames.length - 1}개` : accountNames[0];
  const title = !installations.length ? "GitHub App 연결이 필요해요"
    : suspended ? "GitHub 설치 상태를 확인해 주세요"
    : !repositoryCount ? "GitHub App 설치됨 · 저장소 승인 확인"
    : "GitHub 연결됨";

  return (
    <section className={`connection-status${needsAttention ? " connection-needs-attention" : ""}`} aria-label="GitHub App 연결 상태">
      <div className="connection-summary">
        <Github size={19} aria-hidden="true" />
        <div><h2>{title}{accounts && <span> · {accounts}</span>}</h2>
          {needsAttention && <p>{!installations.length
            ? "GitHub 로그인 후에도 App 설치와 저장소 승인이 필요합니다. 학습할 저장소만 선택해 연결하세요."
            : suspended ? "일시 중지된 설치가 있습니다. GitHub에서 설치 상태와 저장소 권한을 확인해 주세요."
            : "허용된 저장소가 목록에 없습니다. App에서 저장소를 선택한 뒤 권한을 동기화해 주세요."}</p>}
        </div>
      </div>
      <details className="connection-settings" open={needsAttention}>
        <summary>{needsAttention ? "연결 안내 및 설정" : "연결 설정"}<ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="connection-settings-body">
          <p>GitHub App에서 허용하고 현재 사용자에게 접근 권한이 있는 저장소만 연결합니다. 조직 저장소는 조직 정책과 관리자 승인이 필요할 수 있어요.</p>
          {installations.length > 0 && <ul>{installations.map(item => <li key={item.id}>
            <strong>{item.accountLogin}</strong><span>{item.suspendedAt ? "설치 일시 중지" : "설치됨"}</span>
            <small>{item.lastSyncedAt ? `동기화 ${item.lastSyncedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : "동기화 필요"}</small>
          </li>)}</ul>}
          <div className="connection-actions">
            <Link className={needsAttention ? "primary-action" : "secondary-action"} href="/api/github/installations/start">{!installations.length ? "GitHub App 설치하기" : "설치 · 저장소 권한 관리"}</Link>
            <form action={refreshAction}><button className="secondary-action" type="submit"><RefreshCw size={15} />권한 동기화</button></form>
          </div>
          <small>최신 저장소 접근 권한은 분석과 AI 학습 요청 시에도 확인합니다.</small>
        </div>
      </details>
    </section>
  );
}
