import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getGitHubUserAccessToken, githubJson } from "./api";

export interface GitHubInstallationPayload {
  id: number;
  account: { id: number; login: string; type: string };
  repository_selection: string;
  permissions: Record<string, string>;
  suspended_at: string | null;
}

export interface GitHubRepositoryPayload {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
  visibility?: "public" | "private" | "internal";
  owner: { login: string };
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean };
}

export class GitHubAccessDeniedError extends Error {}

// Never reconcile a truncated/partial snapshot as if it were the complete list.
async function completeList<T extends { id: number }>(pathname: string, key: string, token: string): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<number>();
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson<Record<string, unknown>>(`${pathname}?per_page=100&page=${page}`, token, {
      signal: AbortSignal.timeout(15_000),
    });
    const total = payload.total_count;
    const batch = payload[key];
    if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total > 1000
      || (expectedTotal !== undefined && expectedTotal !== total) || !Array.isArray(batch) || batch.length > 100) {
      throw new Error("GitHub 권한 목록을 완전히 확인하지 못했습니다.");
    }
    expectedTotal = total;
    for (const item of batch) {
      if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || seen.has(item.id)) {
        throw new Error("GitHub 권한 목록을 검증하지 못했습니다.");
      }
      seen.add(item.id);
      items.push(item as T);
    }
    if (items.length === total) return items;
    if (batch.length < 100 || items.length > total) break;
  }
  throw new Error("GitHub 권한 목록을 완전히 확인하지 못했습니다.");
}

export function installationCanReadContents(installation: GitHubInstallationPayload): boolean {
  return installation.suspended_at === null
    && (installation.permissions?.contents === "read" || installation.permissions?.contents === "write");
}

export function repositoryCanRead(repository: GitHubRepositoryPayload): boolean {
  const permissions = repository.permissions;
  return permissions?.pull === true || permissions?.push === true || permissions?.maintain === true || permissions?.admin === true;
}

export function listAccessibleRepositories(installationId: string, token: string): Promise<GitHubRepositoryPayload[]> {
  if (!/^\d+$/.test(installationId)) throw new Error("GitHub installation ID가 올바르지 않습니다.");
  return completeList<GitHubRepositoryPayload>(`/user/installations/${installationId}/repositories`, "repositories", token);
}

export async function findAccessibleInstallation(userId: string, installationId: string): Promise<{ installation: GitHubInstallationPayload; token: string }> {
  const token = await getGitHubUserAccessToken(userId);
  const installations = await completeList<GitHubInstallationPayload>("/user/installations", "installations", token);
  const installation = installations.find((item) => String(item.id) === installationId);
  if (installation) return { installation, token };
  throw new GitHubAccessDeniedError("현재 GitHub 사용자에게 허용된 installation이 아닙니다.");
}

function permissionOf(repository: GitHubRepositoryPayload): "ADMIN" | "WRITE" | "READ" {
  if (repository.permissions?.admin) return "ADMIN";
  if (repository.permissions?.maintain || repository.permissions?.push) return "WRITE";
  return "READ";
}

function visibilityOf(repository: GitHubRepositoryPayload): "PUBLIC" | "PRIVATE" | "INTERNAL" {
  if (repository.visibility === "internal") return "INTERNAL";
  return repository.private ? "PRIVATE" : "PUBLIC";
}

export async function saveAndSyncInstallation(
  userId: string,
  installation: GitHubInstallationPayload,
  userToken: string,
): Promise<number> {
  const installationId = String(installation.id);
  const repositories = installationCanReadContents(installation)
    ? (await listAccessibleRepositories(installationId, userToken)).filter(repositoryCanRead) : [];
  const savedInstallation = await db.gitHubInstallation.upsert({
    where: { userId_installationId: { userId, installationId } },
    update: {
      accountId: String(installation.account.id), accountLogin: installation.account.login, accountType: installation.account.type,
      repositorySelection: installation.repository_selection, permissions: installation.permissions as Prisma.InputJsonValue,
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null, lastSyncedAt: new Date(),
    },
    create: {
      userId, installationId, accountId: String(installation.account.id), accountLogin: installation.account.login,
      accountType: installation.account.type, repositorySelection: installation.repository_selection,
      permissions: installation.permissions as Prisma.InputJsonValue,
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null, lastSyncedAt: new Date(),
    },
  });
  const activeRepositoryIds: string[] = [];
  for (const item of repositories) {
    const repository = await db.repository.upsert({
      where: { githubRepositoryId: String(item.id) },
      update: {
        owner: item.owner.login, name: item.name, fullName: item.full_name, htmlUrl: item.html_url,
        defaultBranch: item.default_branch, visibility: visibilityOf(item), isPrivate: item.private,
        isArchived: item.archived, lastGithubSyncAt: new Date(),
      },
      create: {
        githubRepositoryId: String(item.id), owner: item.owner.login, name: item.name, fullName: item.full_name,
        htmlUrl: item.html_url, defaultBranch: item.default_branch, visibility: visibilityOf(item),
        isPrivate: item.private, isArchived: item.archived, lastGithubSyncAt: new Date(),
      },
    });
    activeRepositoryIds.push(repository.id);
    await db.userRepository.upsert({
      where: { userId_repositoryId: { userId, repositoryId: repository.id } },
      update: { installationId: savedInstallation.id, permission: permissionOf(item), active: true },
      create: { userId, repositoryId: repository.id, installationId: savedInstallation.id, permission: permissionOf(item) },
    });
  }
  await db.userRepository.updateMany({
    where: {
      userId,
      installationId: savedInstallation.id,
      ...(activeRepositoryIds.length > 0 ? { repositoryId: { notIn: activeRepositoryIds } } : {}),
    },
    data: { active: false },
  });
  return repositories.length;
}

export async function syncAllUserInstallations(userId: string): Promise<number> {
  const token = await getGitHubUserAccessToken(userId);
  const installations = await completeList<GitHubInstallationPayload>("/user/installations", "installations", token);
  const installationIds = installations.map((installation) => String(installation.id));
  // Revoke disappeared installations only after obtaining a complete snapshot.
  await db.userRepository.updateMany({
    where: { userId, ...(installationIds.length ? { installation: { installationId: { notIn: installationIds } } } : {}) },
    data: { active: false },
  });
  let count = 0;
  for (const installation of installations) count += await saveAndSyncInstallation(userId, installation, token);
  return count;
}
