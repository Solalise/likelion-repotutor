import { securityAnalysisStats } from "@/lib/repository/securityAnalysisStats";
import { loadSampleAnalysis, wantsAnalysisReceipt } from "@/lib/repository/sampleAnalysis";
import { coalesceAnalysis } from "@/lib/repository/analysisWork";
import { NextResponse } from "next/server";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { GithubRepositoryError, loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import { getGithubAnalysisCache, setGithubAnalysisCache } from "@/lib/repository/githubAnalysisCache";
import type { RepositoryAnalysis } from "@/types/analysis";
import { requirePublicRepositoryAccess } from "@/lib/github/publicRepositoryAccess";
import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { parseGithubRepositoryUrl } from "@/lib/repository/loadGithubRepository";
import { reserveAnalysisRun, AnalysisAdmissionError } from "@/lib/repository/analysisAdmission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store"); headers.set("Vary", "Cookie");
  return NextResponse.json(body, { ...init, headers });
}

async function analyzeGithub(repositoryUrl: string): Promise<RepositoryAnalysis> {
  await requirePublicRepositoryAccess(repositoryUrl);
  const loaded = await loadGithubRepository(repositoryUrl);
  await requirePublicRepositoryAccess(repositoryUrl);
  const cacheKey = `${loaded.repository.toLowerCase()}@${loaded.collection.commitSha}`;
  const cached = getGithubAnalysisCache(cacheKey);
  if (cached) {
    return {
      ...cached,
      collection: {
        ...cached.collection!,
        ...loaded.collection,
        source: "github",
        cached: true,
      },
    };
  }
  return coalesceAnalysis(cacheKey, () => {
    const current = getGithubAnalysisCache(cacheKey);
    if (current) return current;
    const analysis: RepositoryAnalysis = {
      ...analyzeSourceFiles(loaded.sources, loaded.repository, loaded.collection.packageManifests), source: "github",
      collection: { source: "github", ...loaded.collection },
    };
    setGithubAnalysisCache(cacheKey, analysis);
    return analysis;
  });
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const source = searchParams.get("source") ?? "sample";
    if (source === "sample") {
      if (process.env.NODE_ENV === "production") return json({ message: "샘플 소스 분석은 로컬 개발 환경에서만 사용할 수 있습니다." }, { status: 403 });
      const { analysis } = await loadSampleAnalysis();
      return json(wantsAnalysisReceipt(request) ? { status: "analysis-complete", repository: analysis.repository } : analysis);
    }
    if (source === "github") {
      const repositoryUrl = searchParams.get("url");
      if (!repositoryUrl) return json({ message: "GitHub 저장소 URL을 입력해 주세요." }, { status: 400 });
      let runId: string | undefined;
      if (process.env.NODE_ENV === "production") {
        let userId: string;
        try { userId = await requireUserId(); }
        catch { return json({ message: "공개 저장소 분석도 GitHub 로그인이 필요합니다." }, { status: 401 }); }
        const coordinates = parseGithubRepositoryUrl(repositoryUrl);
        runId = (await reserveAnalysisRun({ userId, repositoryFullName: coordinates.fullName, source: "PUBLIC_URL" })).id;
      }
      let analysis: RepositoryAnalysis;
      try {
        analysis = await analyzeGithub(repositoryUrl);
        if (runId) await db.analysisRun.update({ where: { id: runId }, data: { status: "COMPLETED", commitSha: analysis.collection?.commitSha, stats: JSON.parse(JSON.stringify({ ...analysis.stats, ...securityAnalysisStats(analysis) })), completedAt: new Date() } });
      } catch (error) {
        if (runId) await db.analysisRun.update({ where: { id: runId }, data: { status: "FAILED", errorCode: "PUBLIC_ANALYSIS_FAILED", completedAt: new Date() } });
        throw error;
      }
      return json(wantsAnalysisReceipt(request) ? { status: "analysis-complete", repository: analysis.repository, commitSha: analysis.collection?.commitSha } : analysis);
    }
    return json({ message: "지원하지 않는 분석 소스입니다." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "분석 중 알 수 없는 오류가 발생했습니다.";
    const status = error instanceof AnalysisAdmissionError ? error.status : error instanceof GithubRepositoryError ? error.status : 500;
    return json({ message }, { status, headers: error instanceof AnalysisAdmissionError && error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined });
  }
}
