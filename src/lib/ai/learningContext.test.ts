import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { RepositoryFeature } from "@/types/analysis";
import { buildLearningContext } from "./learningContext";

const analysis = analyzeSourceFiles([
  {
    path: "app/page.tsx",
    content: `import { loadUser } from "../services/user";
      export function Page() {
        const handleLoad = () => loadUser();
        return <button onClick={handleLoad}>load</button>;
      }`,
  },
  {
    path: "services/user.ts",
    content: `import { findUser } from "../repositories/user";
      export function loadUser() { return findUser(); }`,
  },
  {
    path: "repositories/user.ts",
    content: `export function findUser() { return { id: 1 }; }`,
  },
  {
    path: "services/unrelated.ts",
    content: `export function unrelated() { return "ignore"; }`,
  },
]);

const ids = new Map(analysis.nodes.map((node) => [node.name, node.id]));

describe("buildLearningContext", () => {
  it("extracts only the selected function and its direct callers and callees", () => {
    const context = buildLearningContext(analysis, { type: "function", functionId: ids.get("loadUser")! });

    expect(context.code.map((item) => item.functionName)).toEqual(["loadUser", "handleLoad", "findUser"]);
    expect(context.code.some((item) => item.functionName === "unrelated")).toBe(false);
    expect(context.code[0]).toMatchObject({
      filePath: "services/user.ts",
      functionName: "loadUser",
      startLine: 2,
      endLine: 2,
      distance: 0,
    });
    expect(context.code[0].relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "incoming", otherFunctionName: "handleLoad", relation: "call" }),
      expect.objectContaining({ direction: "outgoing", otherFunctionName: "findUser", relation: "call" }),
    ]));
    expect(context).toMatchObject({ candidateCodeCount: 3, extractedCodeCount: 3, excludedCodeCount: 0 });
  });

  it("reuses feature node IDs and prioritizes the feature entry", () => {
    const feature: RepositoryFeature = {
      id: "feature:user-loading",
      title: "User loading",
      technicalName: "Page",
      description: "test",
      entryNodeId: ids.get("Page")!,
      entryFilePath: "app/page.tsx",
      nodeIds: [ids.get("Page")!, ids.get("handleLoad")!, ids.get("loadUser")!, ids.get("findUser")!],
      filePaths: ["app/page.tsx", "services/user.ts", "repositories/user.ts"],
      connectedNodeCount: 4,
      connectionCount: 3,
      limited: false,
      hidden: false,
      score: 100,
    };

    const context = buildLearningContext(analysis, { type: "feature", feature });

    expect(context.selection).toEqual({ type: "feature", id: feature.id, name: feature.title });
    expect(context.code[0].functionName).toBe("Page");
    expect(context.excluded).toContainEqual(expect.objectContaining({
      functionName: "handleLoad",
      reason: "duplicate-range",
    }));
    expect(context.code.map((item) => item.functionName)).toEqual(["Page", "loadUser", "findUser"]);
  });

  it("keeps the token estimate within the limit and excludes lower-priority code first", () => {
    const context = buildLearningContext(
      analysis,
      { type: "function", functionId: ids.get("loadUser")! },
      { maxInputTokens: 250, safetyMarginRatio: 0 },
    );

    expect(context.estimatedTokens).toBeLessThanOrEqual(250);
    expect(context.code[0].functionName).toBe("loadUser");
    expect(context.excludedCodeCount).toBeGreaterThan(0);
    expect(context.excluded.every((item) => item.functionName !== "loadUser")).toBe(true);
  });

  it("keeps only the selection when it has no related functions", () => {
    const context = buildLearningContext(analysis, {
      type: "function",
      functionId: ids.get("unrelated")!,
    });

    expect(context.code).toHaveLength(1);
    expect(context.code[0]).toMatchObject({ functionName: "unrelated", distance: 0, relations: [] });
    expect(context).toMatchObject({ candidateCodeCount: 1, extractedCodeCount: 1, excludedCodeCount: 0 });
  });

  it("handles cyclic calls without adding duplicate functions", () => {
    const cyclic = analyzeSourceFiles([{
      path: "services/cycle.ts",
      content: `export function first(value: number) {
  return value > 0 ? second(value - 1) : 0;
}
export function second(value: number) {
  return value > 0 ? first(value - 1) : 0;
}`,
    }]);
    const firstId = cyclic.nodes.find((node) => node.name === "first")!.id;
    const context = buildLearningContext(cyclic, { type: "function", functionId: firstId });

    expect(context.code.map((item) => item.functionName)).toEqual(["first", "second"]);
    expect(new Set(context.code.map((item) => item.functionId)).size).toBe(2);
    expect(context.code.flatMap((item) => item.relations)).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "call", otherFunctionName: "second" }),
      expect.objectContaining({ relation: "call", otherFunctionName: "first" }),
    ]));
  });

  it("removes overlapping nested code ranges", () => {
    const nested = analyzeSourceFiles([{
      path: "app/nested.tsx",
      content: `export function Parent() {
  function child() { return 1; }
  return child();
}`,
    }]);
    const parentId = nested.nodes.find((node) => node.name === "Parent")!.id;
    const context = buildLearningContext(nested, { type: "function", functionId: parentId });

    expect(context.code.map((item) => item.functionName)).toEqual(["Parent"]);
    expect(context.excluded).toContainEqual(expect.objectContaining({
      functionName: "child",
      reason: "duplicate-range",
    }));
  });

  it("truncates an oversized selection and excludes lower-priority code within the safe budget", () => {
    const large = analyzeSourceFiles([
      {
        path: "services/large.ts",
        content: `import { helper } from "./helper";
export function large() {
${Array.from({ length: 120 }, (_, index) => `  const value${index} = ${index};`).join("\n")}
  return helper();
}`,
      },
      { path: "services/helper.ts", content: "export function helper() { return true; }" },
    ]);
    const largeId = large.nodes.find((node) => node.name === "large")!.id;
    const context = buildLearningContext(large, { type: "function", functionId: largeId }, {
      maxInputTokens: 600,
      targetInputTokens: 500,
    });

    expect(context).toMatchObject({
      maxInputTokens: 600,
      targetInputTokens: 500,
      usableInputTokens: 425,
      safetyMarginTokens: 75,
      truncatedCodeCount: 1,
    });
    expect(context.estimatedTokens).toBeLessThanOrEqual(context.usableInputTokens);
    expect(context.code[0]).toMatchObject({ functionName: "large", truncated: true });
    expect(context.excluded).toContainEqual(expect.objectContaining({
      functionName: "helper",
      reason: "token-limit",
    }));
  });

  it("preserves exact file paths, line ranges and extracted source", () => {
    const source = `const before = true;

export function exact(value: number) {
  const doubled = value * 2;
  return doubled;
}

const after = true;`;
    const exact = analyzeSourceFiles([{ path: "domain/exact.ts", content: source }]);
    const exactId = exact.nodes.find((node) => node.name === "exact")!.id;
    const context = buildLearningContext(exact, { type: "function", functionId: exactId });
    const item = context.code[0];

    expect(item).toMatchObject({ filePath: "domain/exact.ts", startLine: 3, endLine: 6 });
    expect(item.sourceCode).toBe(source.split("\n").slice(item.startLine - 1, item.endLine).join("\n"));
  });

  it("keeps the 6000-token hard limit while targeting a safer normal context size", () => {
    const context = buildLearningContext(analysis, { type: "function", functionId: ids.get("loadUser")! });

    expect(context).toMatchObject({
      maxInputTokens: 6_000,
      targetInputTokens: 2_500,
      usableInputTokens: 2_125,
      safetyMarginTokens: 375,
    });
    expect(context.estimatedTokens).toBeLessThanOrEqual(context.usableInputTokens);
  });
});
