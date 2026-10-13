import type { RepositoryAnalysis } from "@/types/analysis";

const CACHE_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 8;
const cache = new Map<string, { value: RepositoryAnalysis; storedAt: number }>();

export function getGithubAnalysisCache(key: string): RepositoryAnalysis | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt >= CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function setGithubAnalysisCache(key: string, value: RepositoryAnalysis): void {
  cache.delete(key);
  cache.set(key, { value, storedAt: Date.now() });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

export function clearGithubAnalysisCacheForTests(): void {
  cache.clear();
}
