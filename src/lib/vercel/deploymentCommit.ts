import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { decryptToken } from "@/lib/auth/tokenEncryption";
import { normalizeVercelUrl } from "@/lib/repository/deployment";

export type Json = Record<string, unknown>;
export const object = (value: unknown): Json | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
export const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
export const identifier = (value: unknown): string | undefined => typeof value === "number" && Number.isSafeInteger(value) ? String(value) : text(value);

export class VercelMetadataError extends Error {
  constructor(message: string, public readonly kind: "UNAVAILABLE" | "LOOKUP_FAILED", public readonly httpStatus?: number) { super(message); }
}

export async function vercelJson(path: string, token: string, signal: AbortSignal, allowMissing = false): Promise<Json | undefined> {
  // All callers construct encoded paths to the one official API origin, never target URLs.
  const response = await fetch(`https://api.vercel.com${path}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store", redirect: "error", signal,
  });
  if (allowMissing && response.status === 404) { await response.body?.cancel(); return; }
  if (!response.ok) {
    await response.body?.cancel();
    throw new VercelMetadataError(response.status === 401 ? "Vercel 토큰이 유효하지 않거나 만료되었습니다. 토큰을 교체해 주세요."
      : response.status === 403 ? "Vercel 토큰에 선택한 계정·팀·프로젝트의 메타데이터 조회 권한이 없습니다."
      : response.status === 404 ? "연결한 Vercel 범위에서 해당 배포/프로젝트를 찾을 수 없습니다."
        : "Vercel 공식 API 조회에 실패했습니다. 잠시 후 다시 확인해 주세요.", "LOOKUP_FAILED", response.status);
  }
  if (!response.body) throw new VercelMetadataError("Vercel 응답 본문이 없습니다.", "LOOKUP_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new VercelMetadataError("Vercel 메타데이터 응답 크기 제한을 초과했습니다.", "LOOKUP_FAILED");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const payload = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!payload) throw new VercelMetadataError("Vercel 메타데이터 형식을 확인할 수 없습니다.", "LOOKUP_FAILED");
  return payload;
}

function aliasBinding(alias: Json | undefined, hostname: string) {
  if (!alias || alias.alias !== hostname || alias.redirect || alias.microfrontends || alias.deletedAt) {
    throw new VercelMetadataError("등록 URL의 단일 활성 배포 연결을 공식 API에서 확인할 수 없습니다. 리다이렉트·복합 라우팅은 지원하지 않습니다.", "UNAVAILABLE");
  }
  const deploymentId = text(alias.deploymentId), projectId = text(alias.projectId);
  if (!deploymentId || !projectId) throw new VercelMetadataError("Vercel alias의 배포·프로젝트 식별 정보가 없습니다.", "UNAVAILABLE");
  return { deploymentId, projectId };
}

export async function loadVercelAccount(userId: string) {
  const accounts = await db.account.findMany({ where: { userId, provider: "vercel" }, take: 2,
    select: { id: true, type: true, providerAccountId: true, access_token: true, expires_at: true } });
  const account = accounts.length === 1 ? accounts[0] : undefined;
  if (!account || !["pat", "oauth", "oidc"].includes(account.type) || !account.access_token?.startsWith("enc:v1:")) {
    throw new VercelMetadataError("사용자별 Vercel 인증 연결이 없습니다. 저장소의 Vercel 계정 연결 영역에서 토큰을 연결해 주세요.", "UNAVAILABLE");
  }
  const encryptedToken = account.access_token;
  if (typeof encryptedToken !== "string" || !encryptedToken) {
    throw new VercelMetadataError("저장된 Vercel 암호화 토큰이 없습니다. 계정을 다시 연결해 주세요.", "UNAVAILABLE");
  }
  if (account.expires_at !== null && account.expires_at * 1000 <= Date.now()) {
    throw new VercelMetadataError("Vercel 인증이 만료되었습니다. 재인증이 필요하며 자동 갱신은 아직 지원하지 않습니다.", "UNAVAILABLE");
  }
  let token: string | undefined;
  try { token = decryptToken(encryptedToken); }
  catch { throw new VercelMetadataError("저장된 Vercel 인증 정보를 안전하게 읽지 못했습니다.", "LOOKUP_FAILED"); }
  if (!token) throw new VercelMetadataError("Vercel Access Token을 확인할 수 없습니다.", "UNAVAILABLE");
  const signal = AbortSignal.timeout(15_000);
  const user = object((await vercelJson("/v2/user", token, signal))?.user);
  if (!user || user.id !== account.providerAccountId) throw new VercelMetadataError("Vercel 토큰의 사용자와 연결된 계정이 일치하지 않습니다.", "LOOKUP_FAILED");
  return { account, encryptedToken, token, user, signal };
}

export async function verifyVercelScope(auth: Awaited<ReturnType<typeof loadVercelAccount>>, teamId: string | null) {
  if (!teamId) return;
  if (!/^team_[A-Za-z0-9_-]{1,100}$/.test(teamId)) throw new VercelMetadataError("올바른 Vercel 팀을 선택해 주세요.", "UNAVAILABLE");
  const team = await vercelJson(`/v2/teams/${encodeURIComponent(teamId)}`, auth.token, auth.signal);
  if (!team || team.id !== teamId || team.limited === true || object(team.membership)?.confirmed !== true) {
    throw new VercelMetadataError("선택한 팀의 승인된 멤버십을 확인할 수 없습니다.", "UNAVAILABLE");
  }
}

export async function verifyVercelProject(auth: Awaited<ReturnType<typeof loadVercelAccount>>, projectId: string, teamId: string | null, githubRepositoryId: string) {
  if (!/^prj_[A-Za-z0-9_-]{1,100}$/.test(projectId)) throw new VercelMetadataError("올바른 Vercel 프로젝트를 선택해 주세요.", "UNAVAILABLE");
  await verifyVercelScope(auth, teamId);
  const scope = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const project = await vercelJson(`/v9/projects/${encodeURIComponent(projectId)}${scope}`, auth.token, auth.signal);
  if (!project || project.id !== projectId || project.accountId !== (teamId ?? auth.user.id)) {
    throw new VercelMetadataError("선택한 개인 계정/팀에서 프로젝트 접근 권한을 확인하지 못했습니다.", "UNAVAILABLE");
  }
  const link = object(project.link);
  if (link?.type !== "github" || identifier(link.repoId) !== githubRepositoryId) {
    throw new VercelMetadataError("프로젝트의 GitHub 저장소 ID가 연결 저장소와 일치하지 않습니다.", "UNAVAILABLE");
  }
  return project;
}

/** User-scoped encrypted credentials and an explicitly selected project are mandatory. */
export async function readVercelDeploymentCommit(userId: string, registeredUrl: string, githubRepositoryId: string, selection: {
  vercelAccountId: string | null; vercelTeamId: string | null; vercelProjectId: string | null;
}) {
  const auth = await loadVercelAccount(userId);
  const { account, encryptedToken, token, signal } = auth;
  if (!selection.vercelProjectId || selection.vercelAccountId !== account.id) {
    throw new VercelMetadataError("연결된 Vercel 계정의 프로젝트를 먼저 선택해 저장해 주세요.", "UNAVAILABLE");
  }
  const teamId = selection.vercelTeamId;
  const project = await verifyVercelProject(auth, selection.vercelProjectId, teamId, githubRepositoryId);
  const hostname = new URL(normalizeVercelUrl(registeredUrl)).hostname;
  const scope = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const aliasPath = `/v4/aliases/${encodeURIComponent(hostname)}${scope}`;
  const binding = aliasBinding(await vercelJson(aliasPath, token, signal, true), hostname);
  if (binding.projectId !== selection.vercelProjectId) {
    throw new VercelMetadataError("등록 배포 URL과 명시적으로 선택한 Vercel 프로젝트가 일치하지 않습니다.", "UNAVAILABLE");
  }
  if (project.microfrontends || project.rollingRelease) throw new VercelMetadataError("복합 또는 점진 배포의 단일 커밋 대응은 아직 지원하지 않습니다.", "UNAVAILABLE");
  const query = new URLSearchParams({ withGitRepoInfo: "true", ...(teamId ? { teamId } : {}) });
  const deployment = await vercelJson(`/v13/deployments/${encodeURIComponent(binding.deploymentId)}?${query}`, token, signal);
  if (!deployment || deployment.id !== binding.deploymentId || deployment.projectId !== binding.projectId
    || deployment.readyState !== "READY" || deployment.source !== "git" || deployment.microfrontends) {
    throw new VercelMetadataError("준비 완료된 단일 Git 기반 배포의 메타데이터를 확인할 수 없습니다. CLI 업로드나 사용자 지정 SHA는 검증 근거로 사용하지 않습니다.", "UNAVAILABLE");
  }
  const git = object(deployment.gitSource);
  const sha = text(git?.sha);
  if (git?.type !== "github" || identifier(git.repoId) !== githubRepositoryId || !sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new VercelMetadataError("공식 Git 배포 메타데이터에 저장소 ID와 완전한 커밋 SHA가 없습니다.", "UNAVAILABLE");
  }
  // An alias can move during the lookup. Never attest a different deployment silently.
  const current = aliasBinding(await vercelJson(aliasPath, token, signal), hostname);
  if (current.deploymentId !== binding.deploymentId || current.projectId !== binding.projectId) {
    throw new VercelMetadataError("조회 중 배포 URL이 다른 배포로 변경되었습니다. 다시 확인해 주세요.", "LOOKUP_FAILED");
  }
  return { deployedCommitSha: sha.toLowerCase(), projectId: binding.projectId, deploymentId: binding.deploymentId,
    accountId: account.id, vercelUserId: account.providerAccountId,
    credentialFingerprint: createHash("sha256").update(encryptedToken).digest("hex") };
}
