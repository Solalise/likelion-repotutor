import { describe, expect, it } from "vitest";
import type { LearningContext } from "./learningContext";
import { buildLearningPrompt, learningCacheKey, materializeLearningEvidence, recoverLearningExplanation, validateLearningExplanation } from "./learningExplanation";

const context: LearningContext = {
  repository: "owner/repo",
  selection: { type: "function", id: "fn", name: "loadUser" },
  maxInputTokens: 6000,
  targetInputTokens: 2500,
  usableInputTokens: 2125,
  safetyMarginTokens: 375,
  estimatedTokens: 30,
  candidateCodeCount: 1,
  extractedCodeCount: 1,
  excludedCodeCount: 0,
  truncatedCodeCount: 0,
  excluded: [],
  code: [{
    functionId: "fn", filePath: "src/user.ts", functionName: "loadUser",
    startLine: 10, endLine: 20, importance: 10000, distance: 0,
    sourceCode: Array.from({ length: 11 }, (_, index) => `// line ${10 + index}`).join("\n"), truncated: false, estimatedTokens: 10, relations: [],
  }],
};

const valid = {
  title: "사용자 불러오기",
  role: "사용자 정보를 읽는 역할입니다.",
  executionSteps: ["함수를 호출합니다."],
  keyFunctions: [{
    name: "loadUser", role: "사용자 정보를 준비합니다.",
    evidence: [{ filePath: "src/user.ts", startLine: 10, endLine: 20 }],
  }],
  concepts: [{ name: "함수", explanation: "작업을 묶은 코드입니다." }],
  beginnerExplanation: "사용자 명찰을 찾아오는 과정과 비슷합니다.",
  limitations: ["외부 동작은 코드만으로 확인할 수 없습니다."],
};

describe("validateLearningExplanation", () => {
  it("accepts a grounded Korean explanation", () => {
    expect(validateLearningExplanation(valid, context)).toEqual(valid);
  });

  it("rejects evidence outside supplied lines", () => {
    const invalid = structuredClone(valid);
    invalid.keyFunctions[0].evidence[0].endLine = 21;
    expect(() => validateLearningExplanation(invalid, context)).toThrow(/outside/);
  });

  it("rejects non-Korean explanations", () => {
    expect(() => validateLearningExplanation({ ...valid, role: "Loads a user" }, context)).toThrow(/Korean/);
  });

  it("allows technical concept names when their explanations are Korean", () => {
    const technical = { ...valid, concepts: [{ name: "React Hook", explanation: "상태와 생명주기를 다루는 기능입니다." }] };
    expect(validateLearningExplanation(technical, context).concepts[0].name).toBe("React Hook");
  });

  it("drops unverified key functions but preserves verified evidence", () => {
    const mixed = structuredClone(valid);
    mixed.keyFunctions.push({
      name: "missingFunction",
      role: "존재하지 않는 함수입니다.",
      evidence: [{ filePath: "src/missing.ts", startLine: 1, endLine: 2 }],
    });
    expect(recoverLearningExplanation(mixed, context).keyFunctions).toEqual(valid.keyFunctions);
  });

  it("materializes server-issued evidence IDs without trusting model paths or names", () => {
    const response = {
      ...valid,
      keyFunctions: [{
        name: "inventedName",
        role: "사용자 정보를 준비합니다.",
        evidenceIds: ["E1", "UNKNOWN"],
        evidence: [{ filePath: "src/invented.ts", startLine: 1, endLine: 999 }],
      }],
    };
    const grounded = materializeLearningEvidence(response, context);
    expect(validateLearningExplanation(grounded, context).keyFunctions).toEqual([{
      name: "loadUser",
      role: "사용자 정보를 준비합니다.",
      evidence: [{ filePath: "src/user.ts", startLine: 10, endLine: 20 }],
    }]);
  });

  it("rejects unknown evidence IDs instead of inventing a replacement", () => {
    const response = {
      ...valid,
      keyFunctions: [{ name: "loadUser", role: "사용자 정보를 준비합니다.", evidenceIds: ["UNKNOWN"] }],
    };
    expect(() => recoverLearningExplanation(response, context)).toThrow();
  });

  it("accepts optional learning sections when grounded key functions remain", () => {
    const minimal = { ...valid, title: "loadUser", executionSteps: undefined, concepts: undefined, limitations: undefined };
    expect(validateLearningExplanation(minimal, context)).toMatchObject({
      title: "loadUser", executionSteps: [], concepts: [], limitations: [],
    });
  });

  it("does not expose excluded relation targets as evidence candidates", () => {
    const withExcludedRelation = structuredClone(context);
    withExcludedRelation.code[0].relations.push({
      relation: "call", direction: "outgoing", otherFunctionId: "excluded",
      otherFunctionName: "hiddenFunction", otherFilePath: "src/hidden.ts", line: 30,
    });
    withExcludedRelation.excluded.push({
      functionId: "excluded", filePath: "src/hidden.ts", functionName: "hiddenFunction",
      startLine: 30, endLine: 40, importance: 1, reason: "token-limit",
    });
    const prompt = buildLearningPrompt(withExcludedRelation);
    expect(prompt).not.toContain("hiddenFunction");
    expect(prompt).not.toContain("src/hidden.ts");
    expect(prompt).toContain('"allowedEvidence"');
  });

  it("rejects lines omitted by source truncation", () => {
    const truncated = structuredClone(context);
    truncated.code[0].truncated = true;
    truncated.code[0].sourceCode = "// line 10\n// line 11\n/* ... truncated for context budget ... */";
    const invalid = structuredClone(valid);
    invalid.keyFunctions[0].evidence[0].endLine = 12;
    expect(() => validateLearningExplanation(invalid, truncated)).toThrow(/outside/);
  });
});

describe("learningCacheKey", () => {
  const base = { repositoryId: "repo", commitSha: "sha", selectionType: "function", selectionId: "fn", promptVersion: "v1", model: "model" };

  it("is deterministic and changes with model or prompt", () => {
    expect(learningCacheKey(base)).toBe(learningCacheKey(base));
    expect(learningCacheKey(base)).not.toBe(learningCacheKey({ ...base, model: "other" }));
    expect(learningCacheKey(base)).not.toBe(learningCacheKey({ ...base, promptVersion: "v2" }));
  });
});
