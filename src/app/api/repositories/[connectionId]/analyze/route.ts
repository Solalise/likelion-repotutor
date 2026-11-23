import { wantsAnalysisReceipt } from "@/lib/repository/sampleAnalysis";
import { coalesceAnalysis } from "@/lib/repository/analysisWork";
import { reserveAnalysisRun, AnalysisAdmissionError } from "@/lib/repository/analysisAdmission";
import type { Prisma } from "@prisma/client";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { createInstallationFetcher, getInstallationAccessToken } from "@/lib/github/appAuthentication";
import { getGithubAnalysisCache, githubAnalysisCacheKey, setGithubAnalysisCache } from "@/lib/repository/githubAnalysisCache";
import { loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import type { RepositoryAnalysis } from "@/types/analysis";
import { requireRepositoryAccess, RepositoryAccessError, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";

interface RouteContext { params: Promise<{ connectionId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  const { connectionId } = await context.params;
  let connection;
  try { connection = await requireRepositoryAccess(userId, connectionId); }
  catch (error) { return repositoryAccessResponse(error); }
  let run;
  try { run = await reserveAnalysisRun({ userId, repositoryId: connection.repositoryId,
    repositoryFullName: connection.repository.fullName, source: "CONNECTED_REPOSITORY" }); }
  catch (error) { return repositoryJson({ message: error instanceof AnalysisAdmissionError ? error.message : "분석 요청을 시작할 수 없습니다." },
    { status: error instanceof AnalysisAdmissionError ? error.status : 503,
      headers: error instanceof AnalysisAdmissionError && error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined }); }
  try {
    const token = await getInstallationAccessToken(connection.installation.installationId);
    const namespace = `installation:${connection.installation.installationId}`;
    const loaded = await loadGithubRepository(connection.repository.htmlUrl, createInstallationFetcher(token), namespace);
    // Source collection may take time; recheck before exposing or caching its result.
    await requireRepositoryAccess(userId, connectionId);
    const analysisCacheKey = githubAnalysisCacheKey(namespace, loaded.repository, loaded.collection.commitSha);
    const cached = getGithubAnalysisCache(analysisCacheKey);
    const analysis: RepositoryAnalysis = await coalesceAnalysis(analysisCacheKey, () => {
      const current = cached ?? getGithubAnalysisCache(analysisCacheKey);
      if (current) return current;
      const created: RepositoryAnalysis = {
        ...analyzeSourceFiles(loaded.sources, loaded.repository), source: "github",
        collection: { source: "github", ...loaded.collection },
      };
      setGithubAnalysisCache(analysisCacheKey, created);
      return created;
    });
    await db.$transaction([
      db.analysisRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED", commitSha: loaded.collection.commitSha, stats: JSON.parse(JSON.stringify({
          ...analysis.stats,
          sqlInjection: analysis.sqlInjection ? {
            version: analysis.sqlInjection.version, candidates: analysis.sqlInjection.findings.length,
            inputFlowObserved: analysis.sqlInjection.findings.filter(finding => finding.relationship === "input-flow-observed").length,
            suspected: analysis.sqlInjection.findings.filter(finding => finding.relationship === "suspected").length,
            truncated: analysis.sqlInjection.truncated,
          } : null,
          xss: analysis.xss ? {
            version: analysis.xss.version,
            candidates: analysis.xss.findings.filter(finding => finding.disposition === "candidate").length,
            protectedOutputs: analysis.xss.findings.filter(finding => finding.disposition === "protected").length,
            inputFlowObserved: analysis.xss.findings.filter(finding => finding.disposition === "candidate" && finding.relationship === "input-flow-observed").length,
            truncated: analysis.xss.truncated,
          } : null,
          accessControl: analysis.accessControl ? {
            version: analysis.accessControl.version, status: analysis.accessControl.status,
            idorCandidates: analysis.accessControl.findings.filter(finding => finding.type === "IDOR").length,
            authorizationCandidates: analysis.accessControl.findings.filter(finding => finding.type === "AUTHORIZATION").length,
            boundaries: analysis.accessControl.boundaries.length, truncated: analysis.accessControl.truncated,
          } : null,
        })) as Prisma.InputJsonValue, completedAt: new Date() },
      }),
      db.userRepository.update({ where: { id: connection.id }, data: { lastAccessedAt: new Date() } }),
    ]);
    if (wantsAnalysisReceipt(_request)) return repositoryJson({ status: "analysis-complete", repository: analysis.repository, commitSha: loaded.collection.commitSha });
    return repositoryJson(cached ? {
      ...analysis,
      collection: { ...analysis.collection!, ...loaded.collection, source: "github", cached: true },
    } : analysis);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "연결 저장소 분석에 실패했습니다.";
    await db.analysisRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorCode: error instanceof Error ? error.name : "UNKNOWN", errorMessage: message, completedAt: new Date() },
    });
    return error instanceof RepositoryAccessError ? repositoryAccessResponse(error) : repositoryJson({ message }, { status: 502 });
  }
}
