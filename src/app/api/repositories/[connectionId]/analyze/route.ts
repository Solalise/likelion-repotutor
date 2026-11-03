import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { createInstallationFetcher, getInstallationAccessToken } from "@/lib/github/appAuthentication";
import { getGithubAnalysisCache, githubAnalysisCacheKey, setGithubAnalysisCache } from "@/lib/repository/githubAnalysisCache";
import { loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import type { RepositoryAnalysis } from "@/types/analysis";

interface RouteContext { params: Promise<{ connectionId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 }); }
  const { connectionId } = await context.params;
  const connection = await db.userRepository.findFirst({
    where: { id: connectionId, userId, active: true },
    include: { repository: true, installation: true },
  });
  if (!connection || connection.installation.suspendedAt) {
    return NextResponse.json({ message: "접근이 허용된 연결 저장소를 찾을 수 없습니다." }, { status: 404 });
  }
  const run = await db.analysisRun.create({
    data: {
      repositoryId: connection.repositoryId,
      requestedByUserId: userId,
      repositoryFullName: connection.repository.fullName,
      source: "CONNECTED_REPOSITORY",
      status: "RUNNING",
    },
  });
  try {
    const token = await getInstallationAccessToken(connection.installation.installationId);
    const namespace = `installation:${connection.installation.installationId}`;
    const loaded = await loadGithubRepository(connection.repository.htmlUrl, createInstallationFetcher(token), namespace);
    const analysisCacheKey = githubAnalysisCacheKey(namespace, loaded.repository, loaded.collection.commitSha);
    const cached = getGithubAnalysisCache(analysisCacheKey);
    const analysis: RepositoryAnalysis = cached ?? {
      ...analyzeSourceFiles(loaded.sources, loaded.repository),
      source: "github",
      collection: { source: "github", ...loaded.collection },
    };
    if (!cached) setGithubAnalysisCache(analysisCacheKey, analysis);
    await db.$transaction([
      db.analysisRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED", commitSha: loaded.collection.commitSha, stats: JSON.parse(JSON.stringify(analysis.stats)) as Prisma.InputJsonValue, completedAt: new Date() },
      }),
      db.userRepository.update({ where: { id: connection.id }, data: { lastAccessedAt: new Date() } }),
    ]);
    return NextResponse.json(cached ? {
      ...analysis,
      collection: { ...analysis.collection!, ...loaded.collection, source: "github", cached: true },
    } : analysis);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "연결 저장소 분석에 실패했습니다.";
    await db.analysisRun.update({
      where: { id: run.id },
      data: { status: "FAILED", errorCode: error instanceof Error ? error.name : "UNKNOWN", errorMessage: message, completedAt: new Date() },
    });
    return NextResponse.json({ message }, { status: 502 });
  }
}
