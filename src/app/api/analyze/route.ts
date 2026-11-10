import { loadSampleAnalysis, wantsAnalysisReceipt } from "@/lib/repository/sampleAnalysis";
import { coalesceAnalysis } from "@/lib/repository/analysisWork";
import { NextResponse } from "next/server";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { GithubRepositoryError, loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import { getGithubAnalysisCache, setGithubAnalysisCache } from "@/lib/repository/githubAnalysisCache";
import type { RepositoryAnalysis } from "@/types/analysis";
import { requirePublicRepositoryAccess } from "@/lib/github/publicRepositoryAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "Cache-Control": "private, no-store" } });
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
      ...analyzeSourceFiles(loaded.sources, loaded.repository), source: "github",
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
      const { analysis } = await loadSampleAnalysis();
      return json(wantsAnalysisReceipt(request) ? { status: "analysis-complete", repository: analysis.repository } : analysis);
    }
    if (source === "github") {
      const repositoryUrl = searchParams.get("url");
      if (!repositoryUrl) return json({ message: "GitHub 저장소 URL을 입력해 주세요." }, { status: 400 });
      const analysis = await analyzeGithub(repositoryUrl);
      return json(wantsAnalysisReceipt(request) ? { status: "analysis-complete", repository: analysis.repository, commitSha: analysis.collection?.commitSha } : analysis);
    }
    return json({ message: "지원하지 않는 분석 소스입니다." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "분석 중 알 수 없는 오류가 발생했습니다.";
    const status = error instanceof GithubRepositoryError ? error.status : 500;
    return json({ message }, { status });
  }
}
