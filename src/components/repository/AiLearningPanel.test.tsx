import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryFeature } from "@/types/analysis";
import { AiLearningPanel } from "./AiLearningPanel";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, changed: false }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; state.changed = true; }];
  },
}));

const feature = (id: string): RepositoryFeature => ({
  id, title: id, technicalName: "Page", description: "", entryNodeId: id, entryFilePath: "app/page.tsx",
  nodeIds: [id], filePaths: ["app/page.tsx"], connectedNodeCount: 1, connectionCount: 0, limited: true, hidden: false, score: 0,
});
function content(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(content).join("");
  return React.isValidElement<{ children?: ReactNode }>(node) ? content(node.props.children) : "";
}
function button(node: ReactNode, text: string): (() => unknown) | undefined {
  if (Array.isArray(node)) return node.map((child) => button(child, text)).find(Boolean);
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => unknown }>(node)) return undefined;
  if (node.type === "button" && content(node.props.children).trim() === text) return node.props.onClick;
  return button(node.props.children, text);
}
function render(props: Parameters<typeof AiLearningPanel>[0]) {
  let tree;
  do {
    state.cursor = 0;
    state.changed = false;
    tree = AiLearningPanel(props);
  } while (state.changed);
  return { tree, html: renderToStaticMarkup(tree) };
}
const response = () => new Response(JSON.stringify({ cached: false, model: "test", usage: {}, explanation: {
  title: "이전 대상 설명", role: "역할", beginnerExplanation: "설명", executionSteps: [], keyFunctions: [], concepts: [], limitations: [],
} }), { status: 200 });

describe("AiLearningPanel selection reset", () => {
  beforeEach(() => { state.values = []; state.cursor = 0; });
  afterEach(() => vi.unstubAllGlobals());

  it("resets the displayed result on feature changes while preserving generation", async () => {
    const fetch = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetch);
    const props = { connectionId: "repo", feature: feature("login") };
    await button(render(props).tree, "AI 설명 생성")!();
    expect(render(props).html).toContain("이전 대상 설명");
    expect(render({ ...props, feature: feature("signup") }).html).not.toContain("이전 대상 설명");
    await button(render({ ...props, feature: feature("signup") }).tree, "AI 설명 생성")!();
    expect(JSON.parse(fetch.mock.calls[1][1].body).selection.id).toBe("signup");
  });

  it("resets errors on target changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "임시 오류" }), { status: 502 })));
    const props = { connectionId: "repo", feature: feature("login") };
    await button(render(props).tree, "AI 설명 생성")!();
    expect(render(props).html).toContain("임시 오류");
    expect(render({ ...props, feature: feature("signup") }).html).not.toContain("임시 오류");
  });

  it("resets feature explanations when switching to a selected function or another connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response()));
    const props = { connectionId: "repo", feature: feature("login"), selectedFunction: { id: "fn", name: "handle" } };
    await button(render(props).tree, "AI 설명 생성")!();
    await button(render(props).tree, "선택 함수")!();
    expect(render(props).html).not.toContain("이전 대상 설명");
    await button(render(props).tree, "AI 설명 생성")!();
    expect(render({ ...props, connectionId: "another" }).html).not.toContain("이전 대상 설명");
  });
});
