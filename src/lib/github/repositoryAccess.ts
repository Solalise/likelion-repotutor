import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GitHubApiError, githubJson } from "./api";
import {
  findAccessibleInstallation, GitHubAccessDeniedError, installationCanReadContents,
  listAccessibleRepositories, repositoryCanRead,
} from "./installations";

export class RepositoryAccessError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

// Authorization is deliberately not cached, even when source/AI results are cached.
export async function requireRepositoryAccess(userId: string, connectionId: string) {
  const connection = await db.userRepository.findFirst({
    where: { id: connectionId, userId, active: true },
    include: { repository: true, installation: true },
  });
  if (!connection || connection.installation.userId !== userId) {
    throw new RepositoryAccessError("접근 가능한 연결 저장소를 찾을 수 없습니다.", 404);
  }
  try {
    const { installation, token } = await findAccessibleInstallation(userId, connection.installation.installationId);
    if (!installationCanReadContents(installation)) {
      throw new GitHubAccessDeniedError("GitHub App의 저장소 읽기 권한이 회수되었습니다.");
    }
    const repositories = await listAccessibleRepositories(connection.installation.installationId, token);
    const repository = repositories.find((item) => String(item.id) === connection.repository.githubRepositoryId);
    if (!repository || !repositoryCanRead(repository)) {
      throw new GitHubAccessDeniedError("현재 사용자의 저장소 접근 권한이 회수되었습니다.");
    }
    // Avoid fetching a different repository if a name was reused after a transfer/rename.
    if (repository.full_name.toLowerCase() !== connection.repository.fullName.toLowerCase()) {
      throw new RepositoryAccessError("저장소 정보가 변경되었습니다. 저장소 목록을 동기화해 주세요.", 409);
    }
    // Installation repository lists require only Metadata permission. Probe Contents
    // with the USER token as well, so org policies cannot be bypassed by an app token.
    const [owner, name] = repository.full_name.split("/");
    const contents = await githubJson<unknown>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents`, token, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!Array.isArray(contents)) throw new Error("GitHub Contents 권한 응답을 검증하지 못했습니다.");
    return connection;
  } catch (error) {
    if (error instanceof GitHubAccessDeniedError) {
      await db.userRepository.updateMany({ where: { id: connection.id, userId }, data: { active: false } });
      throw new RepositoryAccessError("저장소 접근 권한이 없습니다. GitHub App 권한을 확인해 주세요.", 403);
    }
    if (error instanceof RepositoryAccessError) throw error;
    if (error instanceof GitHubApiError && error.status === 401) {
      throw new RepositoryAccessError("GitHub 로그인을 확인할 수 없습니다. 다시 로그인해 주세요.", 401);
    }
    // Includes timeouts, rate limits, malformed/partial responses, and GitHub outages.
    // Keep durable state on uncertainty, but never return protected data.
    throw new RepositoryAccessError("GitHub 저장소 권한을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}

export function repositoryJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie");
  return NextResponse.json(body, { ...init, headers });
}

export function repositoryAccessResponse(error: unknown) {
  return repositoryJson({ message: error instanceof RepositoryAccessError ? error.message : "저장소 권한을 확인할 수 없습니다." }, {
    status: error instanceof RepositoryAccessError ? error.status : 503,
  });
}
