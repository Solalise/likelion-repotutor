"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { RepositoryDeployment as Deployment } from "@/lib/repository/deployment";
import { VercelAccountConnection } from "./VercelAccountConnection";
import { subscribeVercelChanged } from "@/lib/vercel/connectionEvents";

type Connection = {
  connectionId: string;
  repository: { fullName: string; htmlUrl: string };
  deployment: Deployment;
};
type Challenge = { filePath: string; fileContent: string; expiresAt: string };

export function RepositoryDeployment({ connectionId }: { connectionId: string }) {
  return <DeploymentConnection key={connectionId} connectionId={connectionId} />;
}

function DeploymentConnection({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection>();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verificationAction, setVerificationAction] = useState<"issue" | "verify">();
  const [challenge, setChallenge] = useState<Challenge>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const endpoint = `/api/repositories/${encodeURIComponent(connectionId)}/deployment`;

  useEffect(() => subscribeVercelChanged(() => {
    setLoading(true); setConnection(undefined); setUrl(""); setError(""); setMessage("");
    setChallenge(undefined); setConnectionEpoch(value => value + 1); router.refresh();
  }), [router]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message ?? "배포 연결 정보를 불러오지 못했습니다.");
        }
        const payload = await response.json() as Connection;
        if (!controller.signal.aborted) {
          setConnection(payload);
          setUrl(payload.deployment.vercelUrl ?? "");
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "연결 정보 조회에 실패했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, connectionEpoch]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || saving || verificationAction) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vercelUrl: url }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? "배포 URL을 저장하지 못했습니다.");
      }
      const payload = await response.json() as Connection;
      setConnection(payload);
      setUrl(payload.deployment.vercelUrl ?? "");
      setChallenge(undefined);
      setMessage("배포 URL을 저장했습니다. 소유권은 아직 검증되지 않았으며 테스트 요청은 허용되지 않습니다.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  async function verification(action: "issue" | "verify") {
    if (!connection || saving || verificationAction) return;
    setVerificationAction(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${endpoint}/verification?action=${action}`, { method: "POST", cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? "소유권 확인 요청에 실패했습니다.");
      }
      const payload = await response.json() as { deployment: Deployment; message?: string } & Partial<Challenge>;
      setConnection({ ...connection, deployment: payload.deployment });
      if (action === "issue" && payload.filePath && payload.fileContent && payload.expiresAt) {
        setChallenge({ filePath: payload.filePath, fileContent: payload.fileContent, expiresAt: payload.expiresAt });
        setMessage("새 토큰을 발급했습니다. 이전 토큰과 검증 상태는 무효화되었습니다.");
      } else {
        setChallenge(undefined);
        setMessage(payload.message ?? "소유권을 확인했습니다.");
      }
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "소유권 확인에 실패했습니다.");
      // Reconcile attempts/expiry and changes from another tab without another target request.
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (response.ok) {
          const latest = await response.json() as Connection;
          setConnection(latest);
          if (latest.deployment.challengeExpiresAt !== challenge?.expiresAt) setChallenge(undefined);
        }
        else { setConnection(undefined); setChallenge(undefined); }
      } catch { setConnection(undefined); setChallenge(undefined); }
    } finally { setVerificationAction(undefined); }
  }

  const busy = saving || Boolean(verificationAction);
  return <section className="tutor-card" aria-labelledby="repository-deployment-title" aria-busy={loading || busy}>
    <h2 id="repository-deployment-title">GitHub 저장소 · Vercel 배포 연결</h2>
    <VercelAccountConnection key={connectionId} connectionId={connectionId} />
    {loading && <p role="status">연결 정보를 불러오는 중입니다.</p>}
    {connection && <>
      <dl className="repository-metadata">
        <div><dt>GitHub 저장소</dt><dd><a href={connection.repository.htmlUrl} target="_blank" rel="noopener noreferrer">{connection.repository.fullName}</a></dd></div>
        <div><dt>저장된 배포 URL</dt><dd>{connection.deployment.vercelUrl ?? "등록되지 않음"}</dd></div>
        <div><dt>소유권 상태</dt><dd>{connection.deployment.ownershipStatus === "VERIFIED" ? "검증 완료" : "미검증"}</dd></div>
        <div><dt>실제 테스트 요청</dt><dd>허용되지 않음</dd></div>
      </dl>
      <form onSubmit={save}>
        <label htmlFor="repository-vercel-url">Vercel 배포 URL</label>
        <input id="repository-vercel-url" name="vercelUrl" type="url" value={url}
          onChange={event => setUrl(event.target.value)} required maxLength={2048}
          placeholder="https://my-project.vercel.app" aria-describedby="repository-deployment-note" disabled={busy} />
        <button className="primary-action" type="submit" disabled={busy}>{saving ? "저장 중…" : "배포 URL 저장"}</button>
      </form>
      {connection.deployment.vercelUrl && <section aria-labelledby="deployment-verification-title">
        <h3 id="deployment-verification-title">배포 사이트 소유권 확인</h3>
        <ol>
          <li>검증 토큰을 발급하고 아래 파일 내용을 복사하세요.</li>
          <li>프로젝트의 정적 파일 폴더에 <code>.well-known/vulnlab-ownership.txt</code>를 배치하세요. Next.js에서는 <code>public/.well-known/vulnlab-ownership.txt</code>입니다.</li>
          <li>등록한 배포 URL에 다시 배포한 뒤 소유권 확인 버튼을 누르세요. 파일은 로그인·리다이렉트 없이 HTTP 200으로 제공되어야 합니다.</li>
        </ol>
        <p>확인 주소: <code>{connection.deployment.vercelUrl}/.well-known/vulnlab-ownership.txt</code></p>
        {challenge && <>
          <p>파일 내용(텍스트만 저장):</p><pre>{challenge.fileContent}</pre>
          <p>토큰 만료: <time dateTime={challenge.expiresAt}>{new Date(challenge.expiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time></p>
        </>}
        {!challenge && connection.deployment.challengeExpiresAt && <p>발급된 토큰은 서버에 해시로만 저장되어 다시 표시할 수 없습니다. 파일을 이미 배포했다면 확인하거나, 내용을 잃어버렸다면 재발급하세요. 만료 시각: <time dateTime={connection.deployment.challengeExpiresAt}>{new Date(connection.deployment.challengeExpiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time></p>}
        {connection.deployment.challengeExpiresAt && <p>이 토큰의 남은 확인 횟수: {connection.deployment.verificationAttemptsRemaining}회</p>}
        <p>토큰은 15분간 유효하며 성공 시 한 번만 사용됩니다. 재발급은 60초 간격, 확인은 10초 간격·토큰당 5회로 제한됩니다. 사용자 전체에서 시간당 발급 10회·확인 30회까지 가능합니다.</p>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => void verification("issue")}>{verificationAction === "issue" ? "발급 중…" : "검증 토큰 발급 / 재발급"}</button>
        <button className="primary-action" type="button" disabled={busy || !connection.deployment.challengeExpiresAt || connection.deployment.ownershipStatus === "VERIFIED"} onClick={() => void verification("verify")}>{verificationAction === "verify" ? "확인 중…" : "소유권 확인"}</button>
        <p>확인 버튼은 저장된 URL만 사용합니다. URL 입력을 바꿨다면 먼저 저장하세요. 검증 성공 후 확인 파일을 제거할 수 있습니다.</p>
      </section>}
    </>}
    <p id="repository-deployment-note">Vercel 기본 도메인 또는 사용자 지정 도메인의 HTTPS 주소를 경로·쿼리 없이 입력하세요. URL 등록만으로 소유권을 인정하지 않습니다. 소유권 확인 버튼을 누를 때만 고정된 확인 파일을 요청합니다. 공개 IPv4와 유효한 TLS 인증서가 필요합니다. 소유권 검증은 GitHub 코드와 배포의 일치나 Vercel 제공 여부를 증명하지 않으며 실제 공격 테스트를 허용하지 않습니다.</p>
    {error && <p className="notice-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
