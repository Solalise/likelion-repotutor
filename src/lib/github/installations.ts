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

interface GitHubRepositoryPayload {
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

interface InstallationList { total_count: number; installations: GitHubInstallationPayload[] }
interface RepositoryList { total_count: number; repositories: GitHubRepositoryPayload[] }

export async function findAccessibleInstallation(userId: string, installationId: string): Promise<{ installation: GitHubInstallationPayload; token: string }> {
  const token = await getGitHubUserAccessToken(userId);
  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson<InstallationList>(`/user/installations?per_page=100&page=${page}`, token);
    const installation = payload.installations.find((item) => String(item.id) === installationId);
    if (installation) return { installation, token };
    if (page * 100 >= payload.total_count) break;
  }
  throw new Error("현재 GitHub 사용자에게 허용된 installation이 아닙니다.");
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
  const repositories: GitHubRepositoryPayload[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson<RepositoryList>(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`, userToken);
    repositories.push(...payload.repositories);
    if (page * 100 >= payload.total_count) break;
  }
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
  let count = 0;
  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson<InstallationList>(`/user/installations?per_page=100&page=${page}`, token);
    for (const installation of payload.installations) count += await saveAndSyncInstallation(userId, installation, token);
    if (page * 100 >= payload.total_count) break;
  }
  return count;
}
