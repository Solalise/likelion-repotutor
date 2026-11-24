import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { getGithubAnalysisCache, githubAnalysisCacheKey } from "@/lib/repository/githubAnalysisCache";
import { generateSecurityGuides } from "@/lib/ai/securityReviewGuide";
import type { Prisma } from "@prisma/client";
import { restoreAnalysis, storedGuide } from "@/lib/repository/persistedAnalysis";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("content-type")?.split(";")[0] !== "application/json") return repositoryJson({ message: "동일 출처 JSON 요청만 허용됩니다." }, { status: 403 });
  let commitSha: string;
  try {
    const text = await request.text(); if (text.length > 1024) throw new Error();
    const body = JSON.parse(text); if (!/^[a-f0-9]{40}$/i.test(body.commitSha)) throw new Error(); commitSha = body.commitSha;
  } catch { return repositoryJson({ message: "분석 커밋을 확인하세요." }, { status: 400 }); }
  const { connectionId } = await context.params;
  try {
    const connection = await requireRepositoryAccess(userId, connectionId);
    const run = await db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, source: "CONNECTED_REPOSITORY", commitSha, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
    if (!run) return repositoryJson({ message: "완료된 분석 기록이 필요합니다." }, { status: 409 });
    const restored = restoreAnalysis(run, connection.repository.fullName);
    if (run.reviewGuide && restored?.savedReviewGuides) {
      await requireRepositoryAccess(userId, connectionId);
      return repositoryJson({ ...restored.savedReviewGuides, cached: true, commitSha, repository: restored.repository });
    }
    const key = githubAnalysisCacheKey(`installation:${connection.installation.installationId}`, connection.repository.fullName, commitSha);
    const analysis = getGithubAnalysisCache(key);
    if (!analysis) {
      if (restored?.savedReviewGuides) {
        await requireRepositoryAccess(userId, connectionId);
        return repositoryJson({ ...restored.savedReviewGuides, commitSha, repository: restored.repository });
      }
      return repositoryJson({ message: "저장된 분석 근거가 없습니다. 저장소를 분석하세요." }, { status: 409 });
    }
    const bundle = await generateSecurityGuides(analysis, `${userId}:${connectionId}`);
    await requireRepositoryAccess(userId, connectionId);
    const safeBundle = storedGuide(bundle);
    // generateSecurityGuides returns AI text only after the existing server validator succeeds.
    if (bundle.origin === "ai" && run.analysisResult) await db.analysisRun.update({ where: { id: run.id }, data: { reviewGuide: JSON.parse(JSON.stringify(safeBundle)) as Prisma.InputJsonValue } });
    return repositoryJson({ ...safeBundle, commitSha, repository: analysis.repository });
  } catch (error) { return repositoryAccessResponse(error); }
}
