import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { restoreAnalysis } from "@/lib/repository/persistedAnalysis";
import { Prisma } from "@prisma/client";

/** Read-only restoration: never collect sources, run AST analysis or call AI. */
export async function GET(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  const { connectionId } = await context.params;
  try {
    const connection = await requireRepositoryAccess(userId, connectionId);
    const run = await db.analysisRun.findFirst({
      where: { requestedByUserId: userId, repositoryId: connection.repositoryId,
        source: "CONNECTED_REPOSITORY", status: "COMPLETED", analysisResult: { not: Prisma.DbNull } },
      orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }],
      select: { analysisResult: true, reviewGuide: true, completedAt: true, commitSha: true },
    });
    await requireRepositoryAccess(userId, connectionId);
    if (!run) return repositoryJson({ analysis: null });
    const analysis = restoreAnalysis(run, connection.repository.fullName);
    if (!analysis) return repositoryJson({ message: "저장된 분석 결과를 읽지 못했습니다. 기존 기록은 유지됩니다." }, { status: 422 });
    return repositoryJson({ analysis });
  } catch (error) { return repositoryAccessResponse(error); }
}
