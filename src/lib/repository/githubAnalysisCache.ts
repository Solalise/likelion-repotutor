import type { RepositoryAnalysis } from "@/types/analysis";
import { BoundedCache } from "@/lib/cache/boundedCache";

const CACHE_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 8;
const cache = new BoundedCache<RepositoryAnalysis>(128*1024*1024,MAX_ENTRIES,CACHE_TTL_MS);

export function githubAnalysisCacheKey(namespace: string, repository: string, commitSha: string): string {
  return `${namespace}:${repository.toLowerCase()}@${commitSha}`;
}

export function getGithubAnalysisCache(key: string): RepositoryAnalysis | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (!Array.isArray(entry.entryPoints)) {
    cache.delete(key);
    return undefined;
  }
  return entry;
}

export function setGithubAnalysisCache(key: string, value: RepositoryAnalysis): void {
  cache.set(key,value);
}

export function clearGithubAnalysisCacheForTests(): void {
  cache.clear();
}
export const deleteGithubAnalysisCache=(key:string)=>cache.delete(key);
export const githubAnalysisCacheStats=()=>cache.stats();
export function retainGithubAnalysisVersion(prefix:string,key:string){for(const old of cache.keys())if(old.startsWith(prefix)&&old!==key)cache.delete(old);}
