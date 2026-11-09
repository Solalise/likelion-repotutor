import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { RepositoryAnalysis, RepositoryFeature } from "@/types/analysis";
import { discoverRepositoryFeatures } from "@/lib/features/featureDiscovery";
import { RepositoryWorkspace } from "./RepositoryWorkspace";

// A small hook harness lets the existing view buttons update state without a DOM.
// Graph components are boundaries here; their rendering/selection is tested separately.
const harness = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, analysis: undefined as RepositoryAnalysis | undefined,
  learning: undefined as unknown, developer: undefined as unknown, picker: undefined as unknown,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => {},
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const index = harness.cursor++;
      if (!(index in harness.states)) harness.states[index] = index === 0 ? harness.analysis
        : typeof initial === "function" ? initial() : initial;
      return [harness.states[index], (next: unknown) => {
        harness.states[index] = typeof next === "function" ? next(harness.states[index]) : next;
      }];
    },
  };
});
vi.mock("@/components/flow/LearningFlow", () => ({
  LearningFlow: (props: unknown) => { harness.learning = props; return <div>학습 그래프</div>; },
}));
vi.mock("@/components/flow/CodeFlow", () => ({
  CodeFlow: (props: unknown) => { harness.developer = props; return <div>개발자 그래프</div>; },
}));
vi.mock("@/components/flow/RepositoryOverviewFlow", () => ({ RepositoryOverviewFlow: () => null }));
vi.mock("@/components/repository/FeaturePicker", () => ({
  FeaturePicker: (props: unknown) => { harness.picker = props; return <div>기능 선택</div>; },
}));

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}
function click(tree: ReactNode, label: string): boolean {
  if (Array.isArray(tree)) return tree.some((child) => click(child, label));
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(tree)) return false;
  if (tree.type === "button" && textOf(tree.props.children).trim() === label) { tree.props.onClick?.(); return true; }
  return click(tree.props.children, label);
}
function workspace(): ReactElement {
  harness.cursor = 0;
  return RepositoryWorkspace({});
}

function changeDepth(tree: ReactNode, value: string): boolean {
  if (Array.isArray(tree)) return tree.some((node) => changeDepth(node, value));
  if (!React.isValidElement<{ children?: ReactNode; type?: string; min?: number; max?: number; onChange?: (event: { target: { value: string } }) => void }>(tree)) return false;
  if (tree.type === "input" && tree.props.type === "number") {
    expect(tree.props.min).toBe(0);
    expect(tree.props.max).toBe(8);
    tree.props.onChange?.({ target: { value } });
    return true;
  }
  return changeDepth(tree.props.children, value);
}

describe("RepositoryWorkspace view switching", () => {
  it("preserves selected nodes through expansion and Depth 0–8 changes within a feature", () => {
    harness.states = [];
    const names = Array.from({ length: 30 }, (_, index) => `work${String(index).padStart(2, "0")}`);
    harness.analysis = { ...analyzeSourceFiles([
      { path: "app/login/page.tsx", content: `import { ${names.join(", ")} } from '../../shared'; export default function Page() { ${names.map((name) => `${name}();`).join(" ")} return <div/>; }` },
      { path: "app/signup/page.tsx", content: "import { work00 } from '../../shared'; export default function Signup() { work00(); return <div/>; }" },
      { path: "shared.ts", content: names.map((name) => `export function ${name}() { return true; }`).join("\n") },
    ]), source: "github" };
    renderToStaticMarkup(workspace());
    const discovery = discoverRepositoryFeatures(harness.analysis);
    const login = discovery.primary.find((feature) => feature.routePath === "/login")!;
    const signup = discovery.primary.find((feature) => feature.routePath === "/signup")!;
    (harness.picker as { onSelect: (feature: RepositoryFeature) => void }).onSelect(login);
    let tree = workspace();
    expect(click(tree, "개발자 보기")).toBe(true);
    tree = workspace();
    expect(click(tree, "기능별 상세 보기")).toBe(true);
    renderToStaticMarkup(workspace());
    type CodeProps = { selectedId?: string; codeNodes: Array<{ id: string }>; onSelect: (id: string) => void };
    const initial = harness.developer as CodeProps;
    expect(initial.codeNodes).toHaveLength(18);
    const selected = initial.codeNodes.find((node) => node.id !== login.entryNodeId)!.id;
    initial.onSelect(selected);
    tree = workspace();
    expect(click(tree, "선택 노드 확장")).toBe(true);
    tree = workspace();
    const html = renderToStaticMarkup(tree);
    const expanded = harness.developer as CodeProps;
    expect(expanded.selectedId).toBe(selected);
    expect(expanded.codeNodes).toHaveLength(28);
    expect(expanded.codeNodes.some((node) => node.id === selected)).toBe(true);
    expect(expanded.codeNodes.some((node) => node.id === signup.entryNodeId)).toBe(false);
    expect(html).toContain("노드 3개/연결 3개 접힘");
    expect(changeDepth(tree, "0")).toBe(true);
    tree = workspace();
    renderToStaticMarkup(tree);
    expect((harness.developer as CodeProps).codeNodes.map((node) => node.id)).toEqual([login.entryNodeId]);
    expect((harness.developer as CodeProps).selectedId).toBe(selected);
    expect(changeDepth(tree, "8")).toBe(true);
    tree = workspace();
    renderToStaticMarkup(tree);
    expect((harness.developer as CodeProps).selectedId).toBe(selected);
    expect((harness.developer as CodeProps).codeNodes.some((node) => node.id === selected)).toBe(true);
    expect(click(tree, "학습용 보기")).toBe(true);
    renderToStaticMarkup(workspace());
    expect(harness.picker).toMatchObject({ selectedFeatureId: login.id });
    expect((harness.learning as { learningNodes: Array<{ id: string }> }).learningNodes.some((node) => node.id === signup.entryNodeId)).toBe(false);
    type LearningProps = { selectedId?: string; learningNodes: Array<{ id: string }>; learningEdges: Array<{ source: string; target: string }>; onSelect: (id: string) => void };
    expect((harness.learning as LearningProps).learningNodes).toHaveLength(28);
    expect((harness.learning as LearningProps).selectedId).toBe(selected);
    tree = workspace();
    expect(changeDepth(tree, "0")).toBe(true);
    renderToStaticMarkup(workspace());
    expect((harness.learning as LearningProps).learningNodes.map((node) => node.id)).toEqual([login.entryNodeId]);
    expect((harness.learning as LearningProps).learningEdges).toEqual([]);
    tree = workspace();
    expect(changeDepth(tree, "8")).toBe(true);
    renderToStaticMarkup(workspace());
    const second = (harness.learning as LearningProps).learningNodes.find((node) => node.id !== login.entryNodeId && node.id !== selected)!.id;
    (harness.learning as LearningProps).onSelect(second);
    tree = workspace();
    expect(click(tree, "선택 노드 확장")).toBe(true);
    renderToStaticMarkup(workspace());
    expect((harness.learning as LearningProps).selectedId).toBe(second);
    expect((harness.learning as LearningProps).learningNodes).toHaveLength(31);
    expect((harness.learning as LearningProps).learningNodes.every((node) => login.nodeIds.includes(node.id))).toBe(true);
  });

  it("keeps the selected route feature and its boundary across both views", () => {
    harness.states = [];
    harness.analysis = { ...analyzeSourceFiles([
      { path: "app/login/page.tsx", content: "import { shared } from '../../shared'; export default function Page() { shared(); return <div/>; }" },
      { path: "app/signup/page.tsx", content: "import { shared } from '../../shared'; export default function Page() { shared(); return <div/>; }" },
      { path: "shared.ts", content: "export function shared() { return true; }" },
    ]), source: "github" };
    let tree = workspace();
    renderToStaticMarkup(tree);
    const discovery = discoverRepositoryFeatures(harness.analysis);
    const login = discovery.primary.find((feature) => feature.routePath === "/login")!;
    const signup = discovery.primary.find((feature) => feature.routePath === "/signup")!;
    (harness.picker as { onSelect: (feature: RepositoryFeature) => void }).onSelect(login);
    tree = workspace();
    renderToStaticMarkup(tree);
    expect(harness.picker).toMatchObject({ selectedFeatureId: login.id });
    expect(harness.learning).toMatchObject({ selectedId: login.entryNodeId });
    expect((harness.learning as { learningNodes: Array<{ id: string }> }).learningNodes.map((node) => node.id)).not.toContain(signup.entryNodeId);
    expect(click(tree, "개발자 보기")).toBe(true);
    tree = workspace();
    expect(click(tree, "기능별 상세 보기")).toBe(true);
    tree = workspace();
    renderToStaticMarkup(tree);
    expect(harness.picker).toMatchObject({ selectedFeatureId: login.id });
    expect((harness.developer as { codeNodes: Array<{ id: string }> }).codeNodes.map((node) => node.id)).not.toContain(signup.entryNodeId);
    expect(click(tree, "학습용 보기")).toBe(true);
    renderToStaticMarkup(workspace());
    expect(harness.picker).toMatchObject({ selectedFeatureId: login.id });
  });

  it("switches learning → developer → learning while preserving the selected original code", () => {
    harness.states = [];
    harness.analysis = {
      ...analyzeSourceFiles([{ path: "app/login/page.tsx", content: "export function LoginPage() { return login(); } function login() { return 'custom'; }" }]),
      source: "github",
    };
    let tree = workspace();
    expect(renderToStaticMarkup(tree)).toContain("학습 그래프");
    const selected = harness.analysis.nodes.find((node) => node.name === "login")!;
    (harness.learning as { onSelect: (id: string) => void }).onSelect(selected.id);
    tree = workspace();
    expect(click(tree, "개발자 보기")).toBe(true);
    tree = workspace();
    expect(click(tree, "기능별 상세 보기")).toBe(true);
    tree = workspace();
    expect(renderToStaticMarkup(tree)).toContain("개발자 그래프");
    expect(harness.developer).toMatchObject({ selectedId: selected.id });
    expect(click(tree, "학습용 보기")).toBe(true);
    tree = workspace();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("학습 그래프");
    expect(html).toContain("custom");
    expect(harness.learning).toMatchObject({ selectedId: selected.id });
    expect(harness.analysis.nodes.find((node) => node.id === selected.id)?.sourceCode).toContain("custom");
  });
});
