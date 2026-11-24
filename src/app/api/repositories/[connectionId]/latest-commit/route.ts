import { requireUserId } from "@/lib/auth/currentUser";
import { requireRepositoryAccess, RepositoryAccessError, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { latestRepositoryCommit } from "@/lib/github/latestRepositoryCommit";

/** Lightweight, read-only HEAD lookup. No source collection, analysis reservation or AI. */
export async function GET(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  const { connectionId } = await context.params;
  try {
    const connection = await requireRepositoryAccess(userId, connectionId);
    const head = await latestRepositoryCommit({ userId, connectionId,
      installationId: connection.installation.installationId,
      repository: connection.repository.fullName, branch: connection.repository.defaultBranch });
    await requireRepositoryAccess(userId, connectionId);
    return repositoryJson({ repository: connection.repository.fullName, ...head });
  } catch (error) {
    if (error instanceof RepositoryAccessError) return repositoryAccessResponse(error);
    return repositoryJson({ message: "최신 상태 확인에 실패했습니다. 저장된 분석 결과는 유지됩니다." }, { status: 503 });
  }
}
