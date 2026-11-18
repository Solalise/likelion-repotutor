import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { encryptToken, tokenEncryptionReady } from "@/lib/auth/tokenEncryption";
import { requireRepositoryAccess } from "@/lib/github/repositoryAccess";
import { identifier, loadVercelAccount, object, text, vercelJson, verifyVercelProject, verifyVercelScope, VercelMetadataError } from "./deploymentCommit";

type Connection = Awaited<ReturnType<typeof requireRepositoryAccess>>;
export class VercelConnectionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
const invalidation = {
  vercelAccountId: null, vercelTeamId: null, vercelProjectId: null,
  deploymentVersion: { increment: 1 }, deploymentOwnershipStatus: "UNVERIFIED" as const,
  deploymentVerifiedAt: null, deploymentTokenHash: null, deploymentTokenExpiresAt: null,
  deploymentVerificationAttempts: 0, deploymentNextVerificationAt: null,
};
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

export async function vercelConnectionStatus(userId: string, connection: Connection) {
  const record = await db.account.findFirst({ where: { userId, provider: "vercel" }, select: { id: true, providerAccountId: true } });
  let identity: { id: string; name: string; username: string | null } | null = null;
  let issue: string | null = null;
  if (record) {
    try {
      const { user } = await loadVercelAccount(userId);
      identity = { id: String(user.id), name: text(user.name) ?? text(user.username) ?? String(user.id), username: text(user.username) ?? null };
    } catch (error) { issue = error instanceof VercelMetadataError ? error.message : "Vercel 연결 상태 확인에 실패했습니다. 토큰을 교체하거나 연결을 해제해 주세요."; }
  }
  const run = await db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, source: "CONNECTED_REPOSITORY", status: "COMPLETED" },
    orderBy: { completedAt: "desc" }, select: { commitSha: true } });
  return { connectionId: connection.id, encryptionReady: tokenEncryptionReady(), connected: Boolean(record), identity, issue,
    analysisCommitSha: run?.commitSha ?? null, deploymentUrl: connection.vercelUrl,
    selection: connection.vercelAccountId === record?.id && connection.vercelProjectId
      ? { teamId: connection.vercelTeamId, projectId: connection.vercelProjectId } : null };
}

export async function connectVercelToken(userId: string, input: unknown) {
  if (!tokenEncryptionReady()) throw new VercelConnectionError("TOKEN_ENCRYPTION_KEY에 base64 32바이트 키 설정이 필요합니다. 토큰은 저장하지 않았습니다.", 503);
  if (typeof input !== "string" || !/^[\x21-\x7e]{16,4096}$/.test(input) || input.startsWith("enc:v1:")) {
    throw new VercelConnectionError("Vercel에서 발급한 토큰을 공백 없이 입력해 주세요.");
  }
  // Encrypt before making API calls; a missing/malformed key can never fall back to plaintext.
  const encrypted = encryptToken(input);
  if (typeof encrypted !== "string" || !encrypted.startsWith("enc:v1:")) throw new VercelConnectionError("토큰 암호화 설정을 확인해 주세요.", 503);
  const user = object((await vercelJson("/v2/user", input, AbortSignal.timeout(10_000)))?.user);
  const id = text(user?.id);
  if (!id || id.length > 160) throw new VercelConnectionError("Vercel 토큰의 계정 식별 정보를 확인하지 못했습니다.");
  try {
    await db.$transaction(async tx => {
      // Serialize this user's credential/binding writes, including disconnect and project selection.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const occupied = await tx.account.findUnique({ where: { provider_providerAccountId: { provider: "vercel", providerAccountId: id } }, select: { userId: true } });
      if (occupied && occupied.userId !== userId) throw new VercelConnectionError("이 Vercel 계정은 다른 로그인 사용자에게 연결되어 있어 연결할 수 없습니다.", 409);
      await tx.userRepository.updateMany({ where: { userId }, data: invalidation });
      await tx.account.deleteMany({ where: { userId, provider: "vercel" } });
      await tx.account.create({ data: { userId, provider: "vercel", providerAccountId: id, type: "pat", token_type: "bearer", access_token: encrypted } });
    });
  } catch (error) {
    if (error instanceof VercelConnectionError) throw error;
    if (object(error)?.code === "P2002") throw new VercelConnectionError("Vercel 계정 연결이 변경되었거나 다른 사용자에게 연결되어 있습니다. 다시 확인해 주세요.", 409);
    throw new VercelConnectionError("Vercel 인증 정보를 저장하지 못했습니다. 기존 연결은 트랜잭션으로 유지됩니다.", 503);
  }
  return { connected: true, identity: { id, name: text(user?.name) ?? text(user?.username) ?? id, username: text(user?.username) ?? null } };
}

export async function disconnectVercel(userId: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    await tx.userRepository.updateMany({ where: { userId }, data: invalidation });
    await tx.account.deleteMany({ where: { userId, provider: "vercel" } });
  });
  return { disconnected: true };
}

function nextCursor(payload: Record<string, unknown> | undefined): string | null {
  const value = identifier(object(payload?.pagination)?.next);
  return value && /^\d{1,20}$/.test(value) ? value : null;
}
export function checkedCursor(cursor: string | null): string | undefined {
  if (cursor === null) return;
  if (!/^\d{1,20}$/.test(cursor)) throw new VercelConnectionError("올바른 목록 커서를 사용해 주세요.");
  return cursor;
}
export function checkedTeam(value: unknown): string | null {
  if (value === null || value === "personal") return null;
  if (typeof value !== "string" || !/^team_[A-Za-z0-9_-]{1,100}$/.test(value)) throw new VercelConnectionError("개인 계정 또는 접근 가능한 팀을 선택해 주세요.");
  return value;
}

export async function vercelTeams(userId: string, cursor?: string) {
  const auth = await loadVercelAccount(userId);
  const params = new URLSearchParams({ limit: "100", ...(cursor ? { until: cursor } : {}) });
  const payload = await vercelJson(`/v2/teams?${params}`, auth.token, auth.signal);
  if (!Array.isArray(payload?.teams)) throw new VercelConnectionError("Vercel 팀 목록 형식을 확인하지 못했습니다.", 502);
  const teams = payload.teams.slice(0, 100).flatMap(item => {
    const team = object(item), id = text(team?.id);
    return id && object(team?.membership)?.confirmed !== false ? [{ id, name: text(team?.name) ?? text(team?.slug) ?? id }] : [];
  });
  return { personal: { id: "personal", name: text(auth.user.username) ?? text(auth.user.name) ?? String(auth.user.id) }, teams, nextCursor: nextCursor(payload) };
}

export async function vercelProjects(userId: string, connection: Connection, teamId: string | null, cursor?: string) {
  const auth = await loadVercelAccount(userId);
  await verifyVercelScope(auth, teamId);
  const params = new URLSearchParams({ limit: "100", ...(teamId ? { teamId } : {}), ...(cursor ? { until: cursor } : {}) });
  const payload = await vercelJson(`/v10/projects?${params}`, auth.token, auth.signal);
  if (!Array.isArray(payload?.projects)) throw new VercelConnectionError("Vercel 프로젝트 목록 형식을 확인하지 못했습니다.", 502);
  const projects = payload.projects.slice(0, 100).flatMap(item => {
    const project = object(item), id = text(project?.id);
    if (!project || !id || project.accountId !== (teamId ?? auth.user.id)) return [];
    const link = object(project.link);
    const selectable = link?.type === "github" && identifier(link.repoId) === connection.repository.githubRepositoryId;
    return [{ id, name: text(project.name) ?? id, selectable,
      reason: selectable ? "GitHub 저장소 ID 일치 · 저장 시 접근 권한 재확인" : "연결 저장소와 GitHub 저장소 ID가 다르거나 Git 연결 정보 없음" }];
  });
  return { projects, nextCursor: nextCursor(payload), teamId };
}

export async function selectVercelProject(userId: string, connection: Connection, projectId: unknown, teamId: string | null) {
  if (typeof projectId !== "string") throw new VercelConnectionError("프로젝트를 선택해 주세요.");
  const auth = await loadVercelAccount(userId);
  await verifyVercelProject(auth, projectId, teamId, connection.repository.githubRepositoryId);
  await requireRepositoryAccess(userId, connection.id);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    const current = await tx.account.findFirst({ where: { id: auth.account.id, userId, provider: "vercel" }, select: { access_token: true } });
    if (!current?.access_token || fingerprint(current.access_token) !== fingerprint(auth.account.access_token!)) {
      throw new VercelConnectionError("조회 중 Vercel 인증이 변경되었습니다. 다시 연결 상태를 확인해 주세요.", 409);
    }
    const updated = await tx.userRepository.updateMany({
      where: { id: connection.id, userId, active: true, deploymentVersion: connection.deploymentVersion },
      data: { ...invalidation, vercelAccountId: auth.account.id, vercelTeamId: teamId, vercelProjectId: projectId },
    });
    if (updated.count !== 1) throw new VercelConnectionError("조회 중 저장소 연결이 변경되었습니다. 새로고침 후 다시 선택해 주세요.", 409);
  });
  return { saved: true, selection: { teamId, projectId } };
}
