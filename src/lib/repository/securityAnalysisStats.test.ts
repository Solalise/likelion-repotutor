import { expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { securityFixtures } from "@/lib/ast/securityFixtures";
import { securityAnalysisStats } from "./securityAnalysisStats";

it("persists small coverage counts while keeping source/evidence in the analysis response", () => {
  const a = analyzeSourceFiles(securityFixtures.sqliVulnerable);
  const summary = securityAnalysisStats(a);
  expect(summary.scannerCoverage.sqlInjection).toMatchObject({ inputs: 1, sinks: 1, connectedSinks: 1, suspectedCandidates: 0 });
  expect(summary.collectionCoverage.inspectedFiles).toBe(2);
  expect(JSON.stringify(summary)).not.toContain("SELECT");
  expect(JSON.stringify(summary)).not.toContain("sourceCode");
  expect(a.sqlInjection?.findings[0].evidence.length).toBeGreaterThan(0);
});
