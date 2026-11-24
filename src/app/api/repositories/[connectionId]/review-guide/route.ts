import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { getGithubAnalysisCache, githubAnalysisCacheKey } from "@/lib/repository/githubAnalysisCache";
import { generateSecurityGuides } from "@/lib/ai/securityReviewGuide";

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
    const run = await db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, commitSha, status: "COMPLETED" } });
    if (!run) return repositoryJson({ message: "완료된 분석 기록이 필요합니다." }, { status: 409 });
    const key = githubAnalysisCacheKey(`installation:${connection.installation.installationId}`, connection.repository.fullName, commitSha);
    const analysis = getGithubAnalysisCache(key);
    if (!analysis) return repositoryJson({ message: "분석 캐시가 만료되어 AI 가이드를 생성하지 못했습니다. 저장소를 다시 분석하세요." }, { status: 409 });
    const bundle = await generateSecurityGuides(analysis, `${userId}:${connectionId}`);
    await requireRepositoryAccess(userId, connectionId);
    return repositoryJson({ ...bundle, commitSha, repository: analysis.repository });
  } catch (error) { return repositoryAccessResponse(error); }
}
