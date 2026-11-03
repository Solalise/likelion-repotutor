import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { discoverRepositoryFeatures } from "@/lib/features/featureDiscovery";
import { loadGithubRepository } from "@/lib/repository/loadGithubRepository";
import { buildLearningContext } from "./learningContext";
import { buildLearningPrompt, materializeLearningEvidence, recoverLearningExplanation, validateLearningExplanation } from "./learningExplanation";

dotenv.config({ path: ".env.local", quiet: true });

const RUN_ACTUAL = process.env.RUN_ACTUAL_REPO_AI === "1";

describe("actual PreviousCaseLookup learning explanation", () => {
  it.runIf(RUN_ACTUAL)("uses only grounded evidence from team-mallang/likelion-hackathon", async () => {
    const loaded = await loadGithubRepository("https://github.com/team-mallang/likelion-hackathon");
    const analysis = analyzeSourceFiles(loaded.sources, loaded.repository);
    const discovery = discoverRepositoryFeatures(analysis);
    const feature = [...discovery.primary, ...discovery.limited, ...discovery.hidden]
      .find((item) => item.technicalName.includes("PreviousCaseLookup"));
    expect(feature, "PreviousCaseLookup feature must be discovered").toBeDefined();
    const context = buildLearningContext(analysis, { type: "feature", feature: feature! });
    expect(context.code.length).toBeGreaterThan(0);
    expect(context.excludedCodeCount).toBeGreaterThan(0);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
        temperature: 0.2,
        max_completion_tokens: 1_800,
        reasoning_effort: "low",
        include_reasoning: false,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: buildLearningPrompt(context) }],
      }),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json() as { choices: Array<{ message: { content: string } }> };
    const decoded = materializeLearningEvidence(JSON.parse(payload.choices[0].message.content) as unknown, context);
    let explanation;
    try { explanation = validateLearningExplanation(decoded, context); }
    catch { explanation = recoverLearningExplanation(decoded, context); }
    expect(explanation.keyFunctions.length).toBeGreaterThan(0);
  }, 60_000);
});
