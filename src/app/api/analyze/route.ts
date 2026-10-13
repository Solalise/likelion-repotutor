import path from "node:path";
import { NextResponse } from "next/server";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { GithubRepositoryError, loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import { getGithubAnalysisCache, setGithubAnalysisCache } from "@/lib/repository/githubAnalysisCache";
import { loadLocalRepository } from "@/lib/repository/loadLocalRepository";
import type { RepositoryAnalysis, SourceInput } from "@/types/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sourceBytes(sources: SourceInput[]): number {
  return sources.reduce((total, source) => total + Buffer.byteLength(source.content, "utf8"), 0);
}

async function analyzeSample(): Promise<RepositoryAnalysis> {
  const startedAt = Date.now();
  const samplePath = path.join(process.cwd(), "sample-repository");
  const sources = await loadLocalRepository(samplePath);
  return {
    ...analyzeSourceFiles(sources),
    source: "sample",
    collection: {
      source: "sample",
      discoveredFiles: sources.length,
      collectedFiles: sources.length,
      totalBytes: sourceBytes(sources),
      durationMs: Date.now() - startedAt,
      partial: false,
    },
  };
}

async function analyzeGithub(repositoryUrl: string): Promise<RepositoryAnalysis> {
  const loaded = await loadGithubRepository(repositoryUrl);
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
  const analysis: RepositoryAnalysis = {
    ...analyzeSourceFiles(loaded.sources, loaded.repository),
    source: "github",
    collection: { source: "github", ...loaded.collection },
  };
  setGithubAnalysisCache(cacheKey, analysis);
  return analysis;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const source = searchParams.get("source") ?? "sample";
    if (source === "sample") return NextResponse.json(await analyzeSample());
    if (source === "github") {
      const repositoryUrl = searchParams.get("url");
      if (!repositoryUrl) return NextResponse.json({ message: "GitHub 저장소 URL을 입력해 주세요." }, { status: 400 });
      return NextResponse.json(await analyzeGithub(repositoryUrl));
    }
    return NextResponse.json({ message: "지원하지 않는 분석 소스입니다." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "분석 중 알 수 없는 오류가 발생했습니다.";
    const status = error instanceof GithubRepositoryError ? error.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
