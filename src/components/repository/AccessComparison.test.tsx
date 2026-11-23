import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccessComparison } from "./AccessComparison";
import { accessImportTemplate } from "@/lib/security-lab/manualAccess";
import { manualAccessFixture, accessTestNow } from "@/lib/security-lab/manualAccess.fixtures";
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial; return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }]; } }));
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(nodes); return isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []; }
function text(node: ReactNode): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(""); return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : ""; }
function field(tree: ReactNode, label: string) { return nodes(tree).find(n => n.props["aria-label"] === label)!; }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.type === "button" && text(n.props.children as ReactNode) === label)!; }
function invoke(node: Element, event: string, value?: unknown) { (node.props[event] as (value: unknown) => void)(value); }
function setup(kind: "IDOR" | "AUTHORIZATION" = "IDOR", readOnly = false) {
  const f = manualAccessFixture(kind); let value = f.comparison; const changed = vi.fn(next => { value = next; }), summary = vi.fn();
  const render = (target = f.target) => { hooks.cursor = 0; return AccessComparison({ target, plan: f.plan, value, binding: f.binding, now: accessTestNow, readOnly, onChange: changed, onSummary: summary }); };
  return { ...f, changed, summary, render, value: () => value };
}
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

it.each(["IDOR", "AUTHORIZATION"] as const)("renders %s expectations, actual manual observations and both phases without executing requests", kind => {
  const f = setup(kind); const html = renderToStaticMarkup(f.render());
  expect(html).toContain(kind === "IDOR" ? "계정 A/B" : "역할별 API"); expect(html).toContain("권한 정책 위반 의심"); expect(html).toContain("서버 미검증"); expect(html).toContain("최초 검사 · 수정 후 재검증");
  expect(html).not.toContain("취약점 확정 완료"); expect(fetch).not.toHaveBeenCalled();
});
it("keeps observations across phase navigation and imports only the matching sanitized JSON", () => {
  const f = setup(); let tree = f.render();
  invoke(field(tree, "A_OTHER 응답 요약"), "onChange", { target: { value: "synthetic denied response" } }); tree = f.render();
  invoke(nodes(tree).find(n => n.type === "select" && n.props.value === "initial")!, "onChange", { target: { value: "retest" } }); tree = f.render();
  expect(field(tree, "A_OTHER 응답 요약").props.value).toBe("synthetic result included");
  const round = structuredClone(f.comparison.retest); round.observations.A_OTHER = { statusCode: 403, access: "DENY", responseSummary: "synthetic denied after fix", rationale: "no foreign resource present" };
  const payload = JSON.stringify(accessImportTemplate(f.binding, f.target, "retest", round));
  invoke(field(tree, "비밀 없는 결과 JSON"), "onChange", { target: { value: payload } }); tree = f.render(); invoke(button(tree, "JSON 수동 결과 가져오기"), "onClick"); tree = f.render();
  expect(field(tree, "A_OTHER HTTP 상태").props.value).toBe(403); expect(field(tree, "비밀 없는 결과 JSON").props.value).toBe(""); expect(text(tree)).toContain("DB 저장은 별도");
  invoke(nodes(tree).find(n => n.type === "select" && n.props.value === "retest")!, "onChange", { target: { value: "initial" } }); tree = f.render(); expect(field(tree, "A_OTHER 응답 요약").props.value).toBe("synthetic denied response");
  invoke(button(tree, "현재 비교 요약을 검사 기록 메모로 복사"), "onClick"); expect(f.summary).toHaveBeenCalledWith("initial", expect.stringContaining("서버 미검증")); expect(fetch).not.toHaveBeenCalled();
});
it("discards credential-bearing import text and refuses a mismatched phase without changing observations", () => {
  const f = setup(); let tree = f.render(); const original = JSON.stringify(f.value());
  invoke(field(tree, "비밀 없는 결과 JSON"), "onChange", { target: { value: "Authorization: Bearer fixture" } }); tree = f.render(); expect(field(tree, "비밀 없는 결과 JSON").props.value).toBe("");
  const wrong = JSON.stringify(accessImportTemplate(f.binding, f.target, "retest", f.comparison.retest));
  invoke(field(tree, "비밀 없는 결과 JSON"), "onChange", { target: { value: wrong } }); tree = f.render(); invoke(button(tree, "JSON 수동 결과 가져오기"), "onClick"); tree = f.render(); expect(text(tree)).toContain("가져오지 않았습니다");
  expect(JSON.stringify(f.value())).toBe(original); expect(f.changed).not.toHaveBeenCalled();
});
it("protects archived data and never reuses observations for a different target", () => {
  const f = setup("IDOR", true); let tree = f.render(); invoke(field(tree, "A_OTHER HTTP 상태"), "onChange", { target: { value: "403" } }); expect(f.changed).not.toHaveBeenCalled();
  invoke(button(tree, "현재 비교 요약을 검사 기록 메모로 복사"), "onClick"); expect(f.summary).not.toHaveBeenCalled();
  tree = f.render({ ...f.target, apiPath: "/api/other" }); expect(text(tree)).toContain("빈 비교표를 읽기 전용"); expect(field(tree, "A_OTHER HTTP 상태").props.value).toBe("");
  expect(nodes(tree).find(n => n.type === "fieldset")!.props.disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
});
