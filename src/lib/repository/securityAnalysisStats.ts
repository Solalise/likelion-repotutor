import type { RepositoryAnalysis } from "@/types/analysis";

/** Small additive JSON summary only. Source code and full manifests stay in the analysis response. */
export function securityAnalysisStats(analysis: RepositoryAnalysis) {
  return {
    scannerRevision: analysis.scannerRevision,
    collectionCoverage: { repositoryFiles: analysis.collection?.repositoryFiles ?? null, analyzableFiles: analysis.collection?.analyzableFiles ?? null,
      inspectedFiles: analysis.files.length, excludedFiles: analysis.collection?.excludedFiles ?? null,
      partial: analysis.collection?.partial ?? false, parseErrors: analysis.diagnostics?.filter(d => d.kind === "parse").length ?? 0,
      unresolvedRelations: analysis.stats.unresolvedRelations ?? 0 },
    scannerCoverage: Object.fromEntries((["sqlInjection", "xss"] as const).map(key => {
      const coverage = analysis[key]?.coverage;
      return [key, coverage ? { status: coverage.status, inputs: coverage.inputs.length, sinks: coverage.sinks.length,
        connectedSinks: coverage.connectedSinks, suspectedCandidates: coverage.suspectedCandidates, boundaries: coverage.diagnostics.length } : null];
    })),
  };
}
