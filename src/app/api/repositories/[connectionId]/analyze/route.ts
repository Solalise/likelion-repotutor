import { securityAnalysisStats } from "@/lib/repository/securityAnalysisStats";
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
import { serializeAnalysis, restoreAnalysis } from "@/lib/repository/persistedAnalysis";
import { saveAnalysisResult, prismaErrorCode } from "@/lib/repository/saveAnalysisResult";

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
  let saving = false;
  try {
    const token = await getInstallationAccessToken(connection.installation.installationId);
    const namespace = `installation:${connection.installation.installationId}`;
    const loaded = await loadGithubRepository(connection.repository.htmlUrl, createInstallationFetcher(token), namespace, { refresh: true });
    // Source collection may take time; recheck before exposing or caching its result.
    await requireRepositoryAccess(userId, connectionId);
    const analysisCacheKey = githubAnalysisCacheKey(namespace, loaded.repository, loaded.collection.commitSha);
    const cached = getGithubAnalysisCache(analysisCacheKey);
    const analysis: RepositoryAnalysis = await coalesceAnalysis(analysisCacheKey, () => {
      const current = cached ?? getGithubAnalysisCache(analysisCacheKey);
      if (current) return current;
      const created: RepositoryAnalysis = {
        ...analyzeSourceFiles(loaded.sources, loaded.repository, loaded.collection.packageManifests), source: "github",
        collection: { source: "github", ...loaded.collection },
      };
      setGithubAnalysisCache(analysisCacheKey, created);
      return created;
    });
    const preparationStarted = performance.now();
    const completedAt = new Date();
    const stored = serializeAnalysis(analysis);
    const durableAnalysis = restoreAnalysis({ analysisResult: stored, completedAt, commitSha: loaded.collection.commitSha }, analysis.repository);
    if (!durableAnalysis) throw new Error("분석 결과를 저장 가능한 형식으로 확인하지 못했습니다.");
    const analysisResultJson = JSON.stringify(stored);
    const statsJson = JSON.stringify({
          ...analysis.stats, ...securityAnalysisStats(analysis),
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
    });
    // All JSON conversion, validation and size measurement finish before the transaction.
    const data: Prisma.AnalysisRunUpdateInput = {
      status: "COMPLETED", commitSha: loaded.collection.commitSha, completedAt,
      analysisResult: JSON.parse(analysisResultJson) as Prisma.InputJsonValue,
      stats: JSON.parse(statsJson) as Prisma.InputJsonValue,
    };
    const metrics = {
      analysisResultBytes: Buffer.byteLength(analysisResultJson, "utf8"),
      statsBytes: Buffer.byteLength(statsJson, "utf8"),
      preparationMs: Math.round(performance.now() - preparationStarted),
    };
    saving = true;
    await saveAnalysisResult({ runId: run.id, connectionId: connection.id, completedAt, data, metrics });
    if (wantsAnalysisReceipt(_request)) return repositoryJson({ status: "analysis-complete", repository: analysis.repository, commitSha: loaded.collection.commitSha });
    return repositoryJson(durableAnalysis);
  } catch (error: unknown) {
    const message = error instanceof RepositoryAccessError ? error.message : saving
      ? "분석 결과 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. 이전에 저장된 성공 결과는 유지됩니다."
      : "저장소 분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요. 이전에 저장된 성공 결과는 유지됩니다.";
    try {
      await db.analysisRun.updateMany({
        // A commit may have succeeded even if the client lost its response; never downgrade it.
        where: { id: run.id, status: "RUNNING" },
        data: { status: "FAILED", errorCode: prismaErrorCode(error) ?? "ANALYSIS_FAILED", errorMessage: message, completedAt: new Date() },
      });
    } catch (recordError) {
      console.warn("[repository-analysis.failure-status]", { runId: run.id, errorCode: prismaErrorCode(recordError) });
    }
    return error instanceof RepositoryAccessError ? repositoryAccessResponse(error) : repositoryJson({ message }, { status: 502 });
  }
}
