import { GithubRepositoryError, parseGithubRepositoryUrl } from "@/lib/repository/loadGithubRepository";

// Public URL analysis must never inherit the server token's private-repository access.
// Check without credentials, including on requests that will hit a source/AST cache.
export async function requirePublicRepositoryAccess(repositoryUrl: string): Promise<void> {
  const coordinates = parseGithubRepositoryUrl(repositoryUrl);
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "RepoTutor", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) throw new GithubRepositoryError("공개 저장소를 찾을 수 없습니다.", 404);
    if (!response.ok) throw new GithubRepositoryError("저장소의 공개 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    const repository = await response.json() as { private?: unknown; full_name?: unknown };
    if (repository.private !== false || typeof repository.full_name !== "string"
      || repository.full_name.toLowerCase() !== coordinates.fullName.toLowerCase()) {
      throw new GithubRepositoryError("현재 공개된 저장소만 URL로 분석할 수 있습니다. 비공개 저장소는 GitHub App으로 연결해 주세요.", 403);
    }
  } catch (error) {
    if (error instanceof GithubRepositoryError) throw error;
    throw new GithubRepositoryError("저장소의 공개 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}
