import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { RepositoryAnalysis } from "@/types/analysis";

const hooks = vi.hoisted(() => ({ scope: "root", cursor: 0, slots: new Map<string, unknown[]>() }));
function scoped<T>(scope: string, render: () => T): T {
  const previous = [hooks.scope, hooks.cursor] as const;
  hooks.scope = scope; hooks.cursor = 0;
  try { return render(); } finally { [hooks.scope, hooks.cursor] = previous; }
}
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++, scope = hooks.scope;
    const values = hooks.slots.get(scope) ?? []; hooks.slots.set(scope, values);
    if (values.length <= index) values.push(typeof initial === "function" ? initial() : initial);
    return [values[index], (value: unknown) => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
  },
  useContext: () => null, useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
}));
vi.mock("./ManualSecurityTarget", async original => {
  const actual = await original<typeof import("./ManualSecurityTarget")>();
  return { ...actual, ManualSecurityTarget: (props: { kind: "IDOR" | "AUTHORIZATION" }) => scoped(props.kind, () => actual.ManualSecurityTarget(props)) };
});
vi.mock("./FindingPreparation", () => ({ FindingPreparation: () => <div /> }));
// These tests cover manual preparation; linked records have their own Provider-scoped integration tests.
vi.mock("./SecurityTestRecord", async original => ({ ...await original<typeof import("./SecurityTestRecord")>(), SecurityTargetRecords: () => <div /> }));
import { ManualSecurityTarget, type ManualSecurityKind } from "./ManualSecurityTarget";
import { SqlInjectionFindings } from "./SqlInjectionFindings";

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : "";
}
function get(node: ReactNode, type: string, label?: string): Element {
  const found = elements(node).find(element => element.type === type && (label === undefined || text(element.props.children as ReactNode) === label || element.props["aria-label"] === label));
  if (!found) throw new Error(`Missing ${type}: ${label}`); return found;
}
function invoke(node: Element, event: string, value: unknown) {
  const action = node.props[event]; if (typeof action !== "function") throw new Error(`Missing ${event}`); action(value);
}
function field(tree: ReactNode, label: string): Element {
  const wrapper = elements(tree).find(element => element.type === "label" && text(element.props.children as ReactNode).startsWith(label));
  const input = wrapper && elements(wrapper.props.children as ReactNode).find(element => element.type === "input" || element.type === "select");
  if (!input) throw new Error(`Missing field ${label}`); return input;
}
const data: RepositoryAnalysis = { repository: "org/app", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 },
  sqlInjection: { version: "sqli-static-v1", findings: [], truncated: false, limitations: [] } };
const parent = () => scoped("root", () => SqlInjectionFindings({ analysis: data, connectionId: "connection-a" }));
const manual = (kind: ManualSecurityKind) => ManualSecurityTarget({ kind });
function panels(tree: ReactNode) {
  return elements(tree).filter(element => element.type === "div" && typeof element.props.hidden === "boolean").map(element => ({ key: element.key, hidden: element.props.hidden }));
}
beforeEach(() => { hooks.slots.clear(); hooks.cursor = 0; hooks.scope = "root"; vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

it("keeps IDOR inputs and preparation across tab switches and edit navigation without sending requests", () => {
  const initialPanels = panels(parent()); expect(initialPanels).toHaveLength(2);
  let tree = manual("IDOR"); expect(get(tree, "button", "준비 화면으로 이동").props.disabled).toBe(true);
  const values: Record<string, string> = { "검사 대상 API 경로": "/api/orders/[id]", "HTTP 메서드": "GET", "검사 목적": "계정 간 객체 접근 확인",
    "기대 동작": "소유자 허용, 다른 계정 거부", "객체 식별자": "order-101", "계정 B 소유 리소스 식별자": "order-202", "리소스 식별자 위치": "path id", "테스트 계정 A": "계정-A", "테스트 계정 B": "계정-B" };
  for (const [label, value] of Object.entries(values)) { invoke(field(tree, label), "onChange", { target: { value } }); tree = manual("IDOR"); }
  invoke(field(tree, "테스트 계정 B"), "onChange", { target: { value: "계정-A" } }); tree = manual("IDOR");
  expect(get(tree, "button", "준비 화면으로 이동").props.disabled).toBe(true);
  invoke(field(tree, "테스트 계정 B"), "onChange", { target: { value: "계정-B" } }); tree = manual("IDOR");
  let root = parent(); invoke(get(root, "button", "권한 검증"), "onClick", undefined); root = parent();
  expect(panels(root).map(panel => panel.key)).toEqual(initialPanels.map(panel => panel.key));
  expect(field(manual("AUTHORIZATION"), "검사 대상 API 경로").props.value).toBe("");
  invoke(get(root, "button", "SQL Injection"), "onClick", undefined); root = parent();
  invoke(get(root, "button", "IDOR"), "onClick", undefined); root = parent();
  expect(panels(root).map(panel => panel.hidden)).toEqual([false, true]);
  tree = manual("IDOR"); expect(field(tree, "객체 식별자").props.value).toBe("order-101");
  invoke(elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); tree = manual("IDOR");
  invoke(get(tree, "form"), "onSubmit", { preventDefault: vi.fn() }); tree = manual("IDOR");
  const markup = renderToStaticMarkup(tree);
  expect(markup).toContain("미실행 · 사용자 작성 준비 정보"); expect(markup).toContain("order-101"); expect(markup).toContain("계정-B");
  expect(get(tree, "button", "실제 요청 실행 · 미지원").props.disabled).toBe(true);
  invoke(get(tree, "button", "수정 화면으로 돌아가기"), "onClick", undefined); tree = manual("IDOR");
  expect(field(tree, "검사 목적").props.value).toBe(values["검사 목적"]); expect(fetch).not.toHaveBeenCalled();
});

it("summarizes authorization expectations as escaped user notes, preserves them, and rejects URL targets", () => {
  let tree = manual("AUTHORIZATION");
  const values: Record<string, string> = { "검사 대상 API 경로": "https://outside.invalid/api/admin", "HTTP 메서드": "POST", "검사 목적": "역할별 접근 확인",
    "기대 동작": "권한 없는 역할 거부", "보호 대상 기능": "<script>user-note</script>", "필요한 역할": "관리자", "허용되어야 하는 역할": "관리자", "거부되어야 하는 역할": "일반 사용자, 비로그인" };
  for (const [label, value] of Object.entries(values)) { invoke(field(tree, label), "onChange", { target: { value } }); tree = manual("AUTHORIZATION"); }
  expect(get(tree, "button", "준비 화면으로 이동").props.disabled).toBe(true);
  invoke(field(tree, "검사 대상 API 경로"), "onChange", { target: { value: "/api/admin/report" } }); tree = manual("AUTHORIZATION");
  invoke(elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); tree = manual("AUTHORIZATION");
  expect(get(tree, "button", "준비 화면으로 이동").props.disabled).toBe(false);
  invoke(get(tree, "form"), "onSubmit", { preventDefault: vi.fn() }); tree = manual("AUTHORIZATION");
  const markup = renderToStaticMarkup(tree);
  expect(markup).toContain("&lt;script&gt;user-note&lt;/script&gt;"); expect(markup).not.toContain("<script>");
  expect(markup).toContain("미실행"); expect(markup).toContain("POST"); expect(markup).toContain("일반 사용자, 비로그인");
  expect(markup).toContain("새로고침");
  let root = parent(); invoke(get(root, "button", "IDOR"), "onClick", undefined); root = parent();
  invoke(get(root, "button", "권한 검증"), "onClick", undefined); root = parent();
  expect(panels(root).map(panel => panel.hidden)).toEqual([true, false]);
  expect(renderToStaticMarkup(manual("AUTHORIZATION"))).toContain("/api/admin/report");
  invoke(get(manual("AUTHORIZATION"), "button", "수정 화면으로 돌아가기"), "onClick", undefined);
  expect(field(manual("AUTHORIZATION"), "필요한 역할").props.value).toBe("관리자"); expect(fetch).not.toHaveBeenCalled();
});

it("registers multiple role-specific API operations without adding an execution path", () => {
  let tree = manual("AUTHORIZATION");
  for (const [label, value] of Object.entries({ "검사 대상 API 경로": "/api/report", "검사 목적": "role access", "기대 동작": "admin allowed", "보호 대상 기능": "report", "필요한 역할": "admin", "허용되어야 하는 역할": "admin", "거부되어야 하는 역할": "user" })) { invoke(field(tree, label), "onChange", { target: { value } }); tree = manual("AUTHORIZATION"); }
  invoke(get(tree, "button", "역할별 API·작업 추가"), "onClick", undefined); tree = manual("AUTHORIZATION");
  for (const [label, value] of Object.entries({ "작업 이름": "archive", "작업 API 경로": "/api/report/archive", "작업 HTTP 메서드": "POST", "admin 기대 접근": "ALLOW", "user 기대 접근": "DENY" })) { invoke(field(tree, label), "onChange", { target: { value } }); tree = manual("AUTHORIZATION"); }
  invoke(elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); tree = manual("AUTHORIZATION");
  expect(get(tree, "button", "준비 화면으로 이동").props.disabled).toBe(false); invoke(get(tree, "form"), "onSubmit", { preventDefault() {} }); tree = manual("AUTHORIZATION");
  const html = renderToStaticMarkup(tree); expect(html).toContain("POST"); expect(html).toContain("/api/report/archive"); expect(html).toContain("user"); expect(html).toContain("접근 거부");
  expect(get(tree, "button", "실제 요청 실행 · 미지원").props.disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
});
