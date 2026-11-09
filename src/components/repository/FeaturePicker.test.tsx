import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { discoverRepositoryFeatures } from "@/lib/features/featureDiscovery";
import type { RepositoryFeature } from "@/types/analysis";
import { FeaturePicker } from "./FeaturePicker";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0 }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next;
    }];
  },
}));

const discovery = discoverRepositoryFeatures(analyzeSourceFiles([
  { path: "app/login/page.tsx", content: "export default function Page() { return <div/>; }" },
  { path: "app/api/users/route.ts", content: "export function GET() {} export function POST() {}" },
  { path: "app/case/documents/page.tsx", content: "export default function Page() { return <div/>; }" },
  { path: "app/case/directions/page.tsx", content: "export default function Page() { return <div/>; }" },
]));
const all = [...discovery.primary, ...discovery.limited];
const onSelect = vi.fn();
function picker(selectedFeatureId?: string): ReactElement {
  hooks.cursor = 0;
  return FeaturePicker({ discovery, selectedFeatureId, onSelect });
}
type Props = { children?: ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void; className?: string; "aria-expanded"?: boolean; "aria-pressed"?: boolean };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  if (typeof node.type === "function") return elements((node.type as (props: Props) => ReactNode)(node.props));
  return [node, ...elements(node.props.children)];
}
function byClass(tree: ReactNode, name: string) { return elements(tree).filter((node) => node.props.className?.split(" ").includes(name)); }
function open(selected?: string) { byClass(picker(selected), "feature-picker-trigger")[0].props.onClick!(); return picker(selected); }
function search(query: string, selected?: string) { elements(picker(selected)).find((node) => node.type === "input")!.props.onChange!({ target: { value: query } }); return picker(selected); }
beforeEach(() => { hooks.states = []; hooks.cursor = 0; onSelect.mockClear(); });

it("shows Korean route labels with an explicit inferred-name annotation and method distinction", () => {
  const selected = all.find((feature) => feature.httpMethod === "GET")!;
  const html = renderToStaticMarkup(open(selected.id));
  expect(html).toContain("로그인");
  expect(html).toContain("이름 추정");
  expect(html).toContain("GET /api/users");
  expect(html).toContain("POST /api/users");
  expect(html).toContain("실제 업무 의미를 확정하지 않습니다");
});

it("expands structural groups without selecting or merging features", () => {
  const tree = open();
  const group = byClass(tree, "feature-group-trigger").find((node) => renderToStaticMarkup(node).includes("사건 처리"))!;
  expect(group.props["aria-expanded"]).toBe(false);
  expect(renderToStaticMarkup(tree)).not.toContain("/case/documents</code>");
  group.props.onClick!();
  expect(renderToStaticMarkup(picker())).toContain("/case/documents</code>");
  expect(renderToStaticMarkup(picker())).toContain("그룹명 추정");
  expect(onSelect).not.toHaveBeenCalled();
  byClass(picker(), "feature-group-trigger").find((node) => renderToStaticMarkup(node).includes("사건 처리"))!.props.onClick!();
  expect(renderToStaticMarkup(picker())).not.toContain("/case/documents</code>");
});

it("passes the exact original child feature and its ID/scope when chosen", () => {
  open();
  const tree = search("서류");
  const feature = all.find((feature) => feature.routePath === "/case/documents")!;
  byClass(tree, "feature-option")[0].props.onClick!();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect.mock.calls[0][0]).toBe(feature);
  expect(onSelect.mock.calls[0][0]).toMatchObject({ id: feature.id, nodeIds: feature.nodeIds, edgeIds: feature.edgeIds });
  expect(byClass(picker(), "feature-picker-popover")).toHaveLength(0);
});

it("finds Korean groups and translated children, auto-expands search, and supports collapse and reset", () => {
  open();
  expect(byClass(search("사건 처리"), "feature-option")).toHaveLength(2);
  expect(byClass(search("길 안내"), "feature-option")).toHaveLength(1);
  byClass(picker(), "feature-group-trigger")[0].props.onClick!();
  expect(byClass(picker(), "feature-option")).toHaveLength(0);
  expect(byClass(search("DOcuments"), "feature-option")).toHaveLength(1);
  expect(byClass(search("Page"), "feature-option")).toHaveLength(3);
  expect(byClass(search("POST"), "feature-option")).toHaveLength(1);
  expect(renderToStaticMarkup(search("존재하지않음"))).toContain("검색 조건에 맞는 기능을 찾지 못했습니다");
  expect(byClass(search(""), "feature-group-trigger")).toHaveLength(3);
});

it("shows common notices once and removes long analysis descriptions from options", () => {
  open();
  const tree = search("app/");
  const html = renderToStaticMarkup(tree);
  expect(html.match(/실행 시점·실행 여부·순서를 보장하지 않습니다/g)).toHaveLength(1);
  expect(html.match(/파일 제한으로 일부 관계가 누락될 수 있습니다/g)).toHaveLength(1);
  expect(html.match(/참조·콜백 전달은 실행을 뜻하지 않습니다/g)).toHaveLength(1);
  for (const option of byClass(tree, "feature-option")) {
    const item = renderToStaticMarkup(option);
    expect(item).not.toContain("확인된 하위 연결");
    expect(item).not.toContain("보장하지");
    expect(item).not.toContain("파일 제한");
    expect(item).not.toContain("요청을 생성");
  }
});

it("opens the selected group and marks only the selected child", () => {
  const selected: RepositoryFeature = all.find((feature) => feature.routePath === "/case/directions")!;
  const tree = open(selected.id);
  expect(byClass(tree, "feature-option").filter((node) => node.props["aria-pressed"])).toHaveLength(1);
  expect(renderToStaticMarkup(byClass(tree, "is-selected")[0])).toContain("/case/directions");
  expect(renderToStaticMarkup(tree)).toContain("선택 항목 포함");
});
