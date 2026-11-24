import type { RepositoryAnalysis } from "./analysis";

export type ServiceAnalysisSnapshot = {
  id: number;
  analysis: RepositoryAnalysis;
  identity: string;
};

/** Compare retained UI inputs, not collection timing/cache metadata. Conservative on schema changes. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function serviceAnalysisIdentity(analysis: RepositoryAnalysis): string {
  const { collection, analyzedAt: _analyzedAt, ...content } = analysis;
  return JSON.stringify(canonical({ ...content, commitSha: collection?.commitSha ?? null }));
}

/** Only the current snapshot may be reused. An archived result never becomes a new verdict. */
export function retainServiceAnalysis(previous: ServiceAnalysisSnapshot[], analysis: RepositoryAnalysis): ServiceAnalysisSnapshot[] {
  const identity = serviceAnalysisIdentity(analysis);
  const current = previous[previous.length - 1];
  if (analysis.collection?.commitSha && current?.identity === identity) return previous;
  return [...previous, { id: (current?.id ?? 0) + 1, identity, analysis }];
}
