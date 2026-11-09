import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { buildLearningContext } from "@/lib/ai/learningContext";
import { loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import { discoverRepositoryFeatures } from "./featureDiscovery";

const RUN_ACTUAL = process.env.RUN_ACTUAL_FEATURE_DISCOVERY === "1";

describe("actual repository feature discovery", () => {
  it.runIf(RUN_ACTUAL)("groups user-facing features in team-mallang/likelion-hackathon", async () => {
    const loaded = await loadGithubRepository("https://github.com/team-mallang/likelion-hackathon");
    const analysis = analyzeSourceFiles(loaded.sources, loaded.repository);
    const discovery = discoverRepositoryFeatures(analysis);
    const visible = [...discovery.primary, ...discovery.limited];
    const pages = visible.filter((feature) => feature.entryKind === "page");
    const names = pages.map((feature) => feature.technicalName);
    expect(pages.length).toBeGreaterThan(0);
    expect(names).not.toEqual(expect.arrayContaining([
      "ConfirmationView", "analyzeCaseWithMock", "POST", "CaseDraftProvider", "requestJson",
      "useExpoAudioRecorder", "expoLocationService.formatLocation", "mockDocumentCreate", "CaseLayout", "CompletionNotice",
    ]));
    expect(pages.map((feature) => feature.routePath)).toEqual(expect.arrayContaining([
      "/", "/case/lookup", "/case/document-scan",
    ]));
    const lookup = pages.find((feature) => feature.routePath === "/case/lookup")!;
    const lookupNames = lookup.nodeIds.map((id) => analysis.nodes.find((node) => node.id === id)?.name);
    expect(lookupNames).toEqual(expect.arrayContaining([
      "PreviousCaseLookupRoute", "PreviousCaseLookupScreen", "previousCaseService.lookup",
    ]));
    expect(lookupNames).not.toContain("ConfirmationScreen");
    const context = buildLearningContext(analysis, { type: "feature", feature: lookup });
    expect(context.selection.id).toBe(lookup.id);
    expect(context.code.some((code) => code.sourceCode.includes("handleSubmit"))).toBe(true);
  }, 60_000);
});
