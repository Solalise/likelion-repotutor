import { isValidElement, type ReactNode } from "react";
import { expect, it } from "vitest";
import { AnalysisSummary } from "@/components/repository/AnalysisSummary";
import { ReviewGuide } from "./ProjectSecurityReview";
import type { RepositoryAnalysis } from "@/types/analysis";

function assertUniqueSiblingKeys(node: ReactNode): void {
  if (Array.isArray(node)) {
    const keys = node.filter(isValidElement).map(element => element.key).filter(key => key !== null);
    expect(new Set(keys).size).toBe(keys.length);
    node.forEach(assertUniqueSiblingKeys);
  } else if (isValidElement<{ children?: ReactNode }>(node)) assertUniqueSiblingKeys(node.props.children);
}

it("renders repeated redacted values from existing DB snapshots with unique sibling keys", () => {
  const hidden = "[비공개 정보 생략]";
  const analysis: RepositoryAnalysis = { repository: "org/app", source: "github", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 },
    technology: { frameworks: [], databases: [], persistence: [], evidence: [], notes: [hidden, hidden] },
    collection: { source: "github", discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, durationMs: 0, partial: false,
      manifest: [{ path: hidden, bytes: 1 }, { path: hidden, bytes: 2 }] },
    sqlInjection: { version: "sqli-static-v1", findings: [], truncated: false, limitations: [hidden, hidden] },
    savedReviewGuides: { origin: "fallback", guides: [{ kind: "SQL_INJECTION", applicability: "inconclusive", summary: "guide", features: [],
      sources: [1, 2].map(() => ({ id: hidden, location: hidden, code: "", reason: hidden })),
      steps: [1, 2].map(() => ({ id: hidden, action: "review", explanation: "review", expected: "review", observe: "review", sourceIds: [] })) }] } };
  assertUniqueSiblingKeys(AnalysisSummary({ analysis }));
  assertUniqueSiblingKeys(ReviewGuide({ analysis, kind: "SQL_INJECTION" }));
  // The fix must not delete or rewrite saved observations to silence display warnings.
  expect(analysis.collection!.manifest).toHaveLength(2);
  expect(analysis.sqlInjection!.limitations).toEqual([hidden, hidden]);
});
