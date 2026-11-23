import { afterEach, describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { clearGithubAnalysisCacheForTests, getGithubAnalysisCache, setGithubAnalysisCache } from "./githubAnalysisCache";

const analysis = analyzeSourceFiles([{ path: "app/settings/page.tsx", content: "export default function Settings() { return <div/>; }" }]);
afterEach(clearGithubAnalysisCacheForTests);

describe("entrypoint metadata cache compatibility", () => {
  it("rejects legacy access snapshots and retries failed additive analyses", () => {
    const legacy = { ...analysis }; delete legacy.accessControl;
    setGithubAnalysisCache("legacy-access", legacy);
    expect(getGithubAnalysisCache("legacy-access")).toBeUndefined();
    setGithubAnalysisCache("failed-access", { ...analysis, accessControl: { ...analysis.accessControl!, status: "failed" } });
    expect(getGithubAnalysisCache("failed-access")).toBeUndefined();
  });
  it("rejects snapshots produced before file-route metadata was available", () => {
    const legacy = { ...analysis };
    delete legacy.entryPoints;
    setGithubAnalysisCache("legacy", legacy);
    expect(getGithubAnalysisCache("legacy")).toBeUndefined();
  });
  it("keeps snapshots with file-route metadata intact", () => {
    setGithubAnalysisCache("current", analysis);
    expect(getGithubAnalysisCache("current")).toBe(analysis);
    expect(getGithubAnalysisCache("current")?.entryPoints).toHaveLength(1);
  });
});
