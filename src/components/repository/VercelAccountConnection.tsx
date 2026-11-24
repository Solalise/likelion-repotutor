"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { type DeploymentCommitComparison } from "@/lib/security-lab/deploymentCommit";
import { ConnectionReadiness } from "./ConnectionReadiness";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import { notifyVercelChanged, subscribeVercelChanged } from "@/lib/vercel/connectionEvents";

type Status = import("@/lib/security-lab/connectionReadiness").VercelConnectionSummary;
type Team = { id: string; name: string };
type Project = { id: string; name: string; selectable: boolean; reason: string };
type Teams = { teams: Team[]; nextCursor: string | null };
type Projects = { projects: Project[]; nextCursor: string | null };

export function VercelAccountConnection({ connectionId, snapshot }: { connectionId: string; snapshot?: DeploymentConnectionSnapshot }) {
  return <AccountConnection key={connectionId} connectionId={connectionId} snapshot={snapshot} />;
}

function AccountConnection({ connectionId, snapshot }: { connectionId: string; snapshot?: DeploymentConnectionSnapshot }) {
  const endpoint = `/api/repositories/${encodeURIComponent(connectionId)}/deployment/vercel`;
  const [status, setStatus] = useState<Status>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamId, setTeamId] = useState("personal");
  const [projectId, setProjectId] = useState("");
  const [teamCursor, setTeamCursor] = useState<string | null>(null);
  const [projectCursor, setProjectCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState("status");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState<DeploymentCommitComparison>();
  const [epoch, setEpoch] = useState(0);
  const active = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function api<T>(url: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as (T & { message?: string }) | null;
    if (!response.ok || !payload) throw new Error(payload?.message ?? "Vercel 요청에 실패했습니다.");
    return payload;
  }

  const refreshStatus = useCallback(() => {
    active.current?.abort();
    formRef.current?.reset();
    setComparison(undefined);
    setStatus(undefined);
    setTeams([]); setProjects([]);
    setBusy("status"); setError(""); setTeamCursor(null); setProjectCursor(null);
    setEpoch(value => value + 1);
  }, []);
  useEffect(() => subscribeVercelChanged(refreshStatus), [refreshStatus]);

  useEffect(() => {
    const controller = new AbortController();
    const form = formRef.current;
    active.current?.abort(); active.current = controller;
    api<Status>(endpoint, controller.signal).then(payload => {
      if (controller.signal.aborted) return;
      setStatus(payload); setTeamId(payload.selection?.teamId ?? "personal"); setProjectId(payload.selection?.projectId ?? "");
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "연결 상태 조회 실패"); })
      .finally(() => { if (!controller.signal.aborted) setBusy(""); });
    return () => { controller.abort(); active.current?.abort(); form?.reset(); };
  }, [endpoint, epoch]);

  async function action(name: string, work: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    setBusy(name); setError(""); setMessage("");
    try { await work(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "연결 요청 실패"); }
    finally { if (!controller.signal.aborted) setBusy(""); }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = new FormData(event.currentTarget).get("vercelAccessToken");
    // Uncontrolled password input only: never keep the submitted token in React state/storage.
    event.currentTarget.reset();
    if (typeof token !== "string" || !status?.encryptionReady || busy) return;
    await action("connect", async signal => {
      await api(endpoint, signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!signal.aborted) { setMessage("Vercel 토큰을 연결했습니다. 팀·프로젝트를 다시 선택하고 사이트 소유권을 확인해 주세요."); notifyVercelChanged(); }
    });
  }

  async function loadTeams(more = false) {
    await action("teams", async signal => {
      const query = new URLSearchParams({ view: "teams", ...(more && teamCursor ? { cursor: teamCursor } : {}) });
      const payload = await api<Teams>(`${endpoint}?${query}`, signal);
      if (!signal.aborted) { setTeams(current => [...new Map([...(more ? current : []), ...payload.teams].map(team => [team.id, team])).values()]); setTeamCursor(payload.nextCursor); }
    });
  }
  async function loadProjects(more = false) {
    await action("projects", async signal => {
      const query = new URLSearchParams({ view: "projects", teamId, ...(more && projectCursor ? { cursor: projectCursor } : {}) });
      const payload = await api<Projects>(`${endpoint}?${query}`, signal);
      if (!signal.aborted) { setProjects(current => [...new Map([...(more ? current : []), ...payload.projects].map(project => [project.id, project])).values()]); setProjectCursor(payload.nextCursor); }
    });
  }

  const usable = Boolean(status?.encryptionReady && status.connected && status.identity);
  return <section aria-labelledby="vercel-account-title" aria-busy={Boolean(busy)}>
    <h3 id="vercel-account-title">Vercel 계정 및 프로젝트 연결</h3>
    <p>연결 상태: {busy === "status" ? "확인 중" : !status ? "확인하지 못함" : !status.encryptionReady ? "암호화 키 설정 필요" : status.connected ? status.identity ? "공식 API에서 계정 확인됨" : "저장된 연결 확인 필요" : "미연결"}</p>
    {status?.identity && <p>계정: {status.identity.name}{status.identity.username ? ` (@${status.identity.username})` : ""} · ID: <code>{status.identity.id}</code></p>}
    <p>저장된 프로젝트: {status?.selection ? `${status.selection.teamId ?? "개인 계정"} / ${status.selection.projectId}` : "미선택"} · 이미 연결된 계정·프로젝트는 다시 등록하지 않아도 됩니다.</p>
    {status?.encryptionReady === false && <p className="notice-error" role="alert">{status.message ?? "TOKEN_ENCRYPTION_KEY 설정이 필요합니다. 토큰은 저장할 수 없습니다."}</p>}
    {status?.issue && <p className="notice-error" role="alert">{status.issue}</p>}
    <ConnectionReadiness connectionId={connectionId} snapshot={snapshot} account={status} comparison={comparison} />
    <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={notifyVercelChanged}>연결 상태 새로고침</button>
    <button className="secondary-action" type="button" disabled={Boolean(busy) || !usable || !status?.selection || !status?.analysisCommitSha || !snapshot?.deployment.vercelUrl} onClick={() => void action("commit", async signal => {
      setComparison(undefined);
      const payload = await api<DeploymentCommitComparison>(`${endpoint.replace(/\/vercel$/, "")}/commit`, signal, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisCommitSha: status!.analysisCommitSha }) });
      if (!signal.aborted) setComparison(payload);
    })}>{busy === "commit" ? "배포 커밋 확인 중…" : "배포 커밋 확인"}</button>
    <details><summary>Vercel 계정 관리 · 토큰 교체 / 연결 해제</summary>
    <p>GitHub 로그인은 유지하며 Vercel Access Token을 별도로 연결합니다. 정상 연결은 다시 입력하지 마세요.</p>
    <p><a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">Vercel에서 토큰 발급하기 ↗</a></p>
    <form ref={formRef} onSubmit={connect} autoComplete="off">
      <label htmlFor="vercel-access-token">Vercel 개인 Access Token</label>
      <input id="vercel-access-token" name="vercelAccessToken" type="password" autoComplete="off" spellCheck={false}
        minLength={16} maxLength={4096} required disabled={Boolean(busy) || status?.encryptionReady !== true} />
      <button className="primary-action" type="submit" disabled={Boolean(busy) || status?.encryptionReady !== true}>{busy === "connect" ? "확인 중…" : status?.connected ? "토큰 교체" : "Vercel 계정 연결"}</button>
    </form>
    <p>토큰은 제출 즉시 입력창에서 지우며 브라우저 저장소에 보관하지 않습니다. 연결·교체·해제는 이 로그인 사용자의 모든 저장소에 영향을 주고 기존 프로젝트 선택·소유권 검증을 무효화합니다. GitHub 연결과 등록된 배포 URL은 유지됩니다.</p>
    {status?.connected && <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void action("disconnect", async signal => {
      await api(endpoint, signal, { method: "DELETE" });
      if (!signal.aborted) { setMessage("이 앱의 Vercel 연결을 해제했습니다. 토큰 자체 폐기는 Vercel에서 진행해 주세요."); notifyVercelChanged(); }
    })}>Vercel 연결 해제</button>}
    </details>
    {usable && <details><summary>Vercel 프로젝트 관리 · 선택 / 변경</summary>
      <label htmlFor="vercel-team">개인 계정 / 팀</label>
      <select id="vercel-team" value={teamId} disabled={Boolean(busy)} onChange={event => { setTeamId(event.target.value); setProjects([]); setProjectId(""); setProjectCursor(null); }}>
        <option value="personal">개인 계정 ({status?.identity?.username ?? status?.identity?.name})</option>
        {teamId !== "personal" && !teams.some(team => team.id === teamId) && <option value={teamId}>저장된 팀: {teamId}</option>}
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void loadTeams()}>접근 가능한 팀 조회</button>
      {teamCursor && <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void loadTeams(true)}>팀 더 보기</button>}
      <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void loadProjects()}>선택 범위의 프로젝트 조회</button>
      <label htmlFor="vercel-project">GitHub 저장소에 대응하는 프로젝트</label>
      <select id="vercel-project" value={projectId} disabled={Boolean(busy) || !projects.length} onChange={event => setProjectId(event.target.value)}>
        <option value="">프로젝트 선택</option>
        {projectId && !projects.some(project => project.id === projectId) && <option value={projectId}>저장된 프로젝트: {projectId}</option>}
        {projects.map(project => <option key={project.id} value={project.id} disabled={!project.selectable}>{project.name}{project.selectable ? " · 저장소 ID 일치" : " · 선택 불가: 저장소 불일치/정보 없음"}</option>)}
      </select>
      {projectCursor && <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={() => void loadProjects(true)}>프로젝트 더 보기</button>}
      <button className="primary-action" type="button" disabled={Boolean(busy) || !projects.some(project => project.id === projectId && project.selectable)} onClick={() => void action("project", async signal => {
        await api(endpoint, signal, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: teamId === "personal" ? null : teamId, projectId }) });
        if (!signal.aborted) { setMessage("프로젝트를 연결했습니다. 변경된 연결의 사이트 소유권을 다시 확인해 주세요."); notifyVercelChanged(); }
      })}>프로젝트 연결 저장</button>
      <p>프로젝트 이름은 일치 근거가 아닙니다. GitHub 저장소 ID와 현재 계정·팀의 프로젝트 읽기 권한을 서버에서 다시 검사합니다.</p>
      <p>소유권·커밋 일치와 실습 승인은 별도입니다. 실제 공격 실행은 계속 비활성화되어 있습니다.</p>
    </details>}
    {error && <p className="notice-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
