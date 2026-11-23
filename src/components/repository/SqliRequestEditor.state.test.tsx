import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { safeSqliProbe } from "@/lib/security-lab/sqliProbe";
import { PracticeTargetEditor } from "./PracticeTargetEditor";
import { SqliRequestEditor, SqliResponseComparison } from "./SqliRequestEditor";
import { sqliTargetKey, type SqliComparisonResult, type SqliRequestDraft } from "@/lib/security-lab/sqliTypes";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { PracticeFinding } from "@/lib/security-lab/practiceTarget";
import { XssRequestEditor, XssResponseComparison } from "./XssRequestEditor";
import { safeXssProbe } from "@/lib/security-lab/xssProbe";
import { xssTargetKey, type XssRequestDraft, type XssComparisonResult } from "@/lib/security-lab/xssTypes";
import { SecurityTestRecord } from "./SecurityTestRecord";

const hooks = vi.hoisted(() => ({ scope: "", cursor: 0, slots: new Map<string, unknown[]>(), effects: [] as (() => void)[], history: null as { results: SqliComparisonResult[]; add: (result: SqliComparisonResult) => void } | null, xssHistory: null as { results: XssComparisonResult[]; add: (result: XssComparisonResult) => void } | null }));
vi.mock("./SqliObservationHistory", () => ({ useSqliObservationHistory: () => hooks.history }));
vi.mock("./XssObservationHistory", () => ({ useXssObservationHistory: () => hooks.xssHistory }));
type Effect = { deps: unknown[]; cleanup?: () => void };
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useContext: () => null, useCallback: (fn: unknown) => fn,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const slots = hooks.slots.get(hooks.scope)!, index = hooks.cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const slots = hooks.slots.get(hooks.scope)!, index = hooks.cursor++;
    return slots[index] ?? (slots[index] = { current: initial });
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const slots = hooks.slots.get(hooks.scope)!, index = hooks.cursor++, previous = slots[index] as Effect | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      hooks.effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: run() } as Effect; });
    }
  },
}));
vi.mock("@/lib/security-lab/practiceTarget", async original => ({ ...await original<typeof import("@/lib/security-lab/practiceTarget")>(),
  practiceTarget: () => ({ path: "/api/search", method: "GET", status: "STATIC_HANDLER", reason: "fixture" }),
}));
type Element = ReactElement<Record<string, unknown>>;
function render(scope: string, fn: () => ReactNode): ReactNode {
  hooks.scope = scope; hooks.cursor = 0;
  if (!hooks.slots.has(scope)) hooks.slots.set(scope, []);
  const tree = fn(); hooks.effects.splice(0).forEach(effect => effect()); return tree;
}
function unmount(scope: string) {
  for (const slot of hooks.slots.get(scope) ?? []) (slot as Effect | null)?.cleanup?.();
  hooks.slots.delete(scope);
}
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : [];
}
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : "";
}
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.type === "button" && text(n.props.children as ReactNode) === label)!; }
function invoke(node: Element, event: string, argument?: unknown) { (node.props[event] as (a: unknown) => void)(argument); }
function change(node: Element, value: string) { invoke(node, "onChange", { target: { value }, stopPropagation() {} }); }
function editor(element: Element) {
  const wrapper = SqliRequestEditor(element.props as Parameters<typeof SqliRequestEditor>[0]);
  return render("editor", () => (wrapper.type as (p: unknown) => ReactNode)(wrapper.props));
}
function input(tree: ReactNode, label: string) {
  const field = nodes(tree).find(n => n.type === "label" && text(n.props.children as ReactNode).startsWith(label))!;
  return nodes(field.props.children as ReactNode).find(n => n.type === "input" || n.type === "select")!;
}
const analysis = { repository: "org/app", collection: { commitSha: "a".repeat(40) } } as RepositoryAnalysis;
const finding = { id: "candidate-a", type: "SQL_INJECTION", filePath: "route.ts", line: 1, endLine: 2 } as PracticeFinding;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { hooks.slots.clear(); hooks.effects = []; hooks.history = null; hooks.xssHistory = null; fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { for (const scope of [...hooks.slots.keys()]) unmount(scope); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("preserves parent-owned inputs and server evidence across back/re-entry, resets approval and invalidates changed targets", async () => {
  const parent = () => render("parent", () => PracticeTargetEditor({ analysis, finding, baseUrl: "https://sandbox.vercel.app", ownership: true, connectionId: "connection-a" }));
  let tree = parent();
  change(input(tree, "입력 위치"), "query"); tree = parent();
  change(input(tree, "테스트 파라미터"), "q"); tree = parent();
  invoke(nodes(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true }, stopPropagation() {} }); tree = parent();
  invoke(nodes(tree).find(n => n.type === "form")!, "onSubmit", { preventDefault() {} }); tree = parent();
  invoke(button(tree, "SQLi 요청 편집기로 이동"), "onClick"); tree = parent();
  let element = nodes(tree).find(n => n.type === SqliRequestEditor)!;
  let ui = editor(element);
  change(input(ui, "정상 요청 입력값"), "normal"); ui = editor(element);
  expect(input(ui, "테스트 요청 입력값").props.readOnly).toBe(true);
  invoke(button(ui, "실습 준비로 돌아가기"), "onClick"); unmount("editor"); tree = parent();
  invoke(button(tree, "SQLi 요청 편집기로 이동"), "onClick"); tree = parent();
  element = nodes(tree).find(n => n.type === SqliRequestEditor)!; ui = editor(element);
  expect(input(ui, "정상 요청 입력값").props.value).toBe("normal");
  expect(input(ui, "테스트 요청 입력값").props.value).toBe(safeSqliProbe.value);
  const request = { ...(element.props.initialDraft as SqliRequestDraft), baseline: { value: "normal" }, test: { value: safeSqliProbe.value } };
  const result: SqliComparisonResult = { runId: "fixture-not-real-execution", request, baseline: { requestId: "baseline", observedAt: new Date().toISOString(), outcome: "RESPONSE", statusCode: 200, durationMs: 1, body: "normal", bodyTruncated: false, errorMessage: null }, test: { requestId: "test", observedAt: new Date().toISOString(), outcome: "RESPONSE", statusCode: 500, durationMs: 2, body: "error", bodyTruncated: false, errorMessage: null },
    assessment: { status: "INCONCLUSIVE", reason: "fixture", evidenceReferences: [] } };
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true, expiresAt: new Date(Date.now() + 60000).toISOString(), remainingRequests: 2, approvalId: "approval", targetId: "target" }) });
  invoke(button(ui, "서버 실행 승인 확인 · 대상 요청 없음"), "onClick"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); await Promise.resolve(); ui = editor(element);
  const consent = nodes(ui).find(n => n.type === "input" && n.props.type === "checkbox")!;
  invoke(consent, "onChange", { target: { checked: true } }); ui = editor(element);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ result }) });
  invoke(button(ui, "정상값·테스트값 요청 전송"), "onClick"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); await Promise.resolve(); ui = editor(element);
  expect(nodes(ui).find(n => n.type === SqliResponseComparison)!.props.result).toBe(result);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true, expiresAt: new Date(Date.now() + 60000).toISOString(), remainingRequests: 2, approvalId: "approval", targetId: "target" }) });
  invoke(button(ui, "서버 실행 승인 확인 · 대상 요청 없음"), "onClick"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3)); await Promise.resolve(); ui = editor(element);
  expect(nodes(ui).find(n => n.type === "input" && n.props.type === "checkbox")!.props.disabled).toBe(false);
  invoke(button(ui, "실습 준비로 돌아가기"), "onClick"); unmount("editor"); tree = parent();
  invoke(button(tree, "SQLi 요청 편집기로 이동"), "onClick"); tree = parent(); element = nodes(tree).find(n => n.type === SqliRequestEditor)!; ui = editor(element);
  expect(nodes(ui).find(n => n.type === SqliResponseComparison)!.props.result).toBe(result);
  expect(button(ui, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
  expect(nodes(ui).find(n => n.props.id === "sqli-execution-unavailable")!.props.children).toContain("기본 상태");
  const original = element.props.initialDraft as SqliRequestDraft;
  for (const changed of [ { ...original, connectionId: "other" }, { ...original, repository: "org/other" }, { ...original, commitSha: "b".repeat(40) },
    { ...original, findingId: "other" }, ...Object.entries({ deploymentOrigin: "https://other.vercel.app", apiPath: "/api/other", method: "POST", inputLocation: "body", parameter: "other" }).map(([key, value]) => ({ ...original, target: { ...original.target, [key]: value } })) ]) {
    expect(sqliTargetKey(changed)).not.toBe(sqliTargetKey(original));
    unmount("editor"); const changedUi = editor({ ...element, props: { ...element.props, initialDraft: changed } });
    expect(nodes(changedUi).find(n => n.type === SqliResponseComparison)!.props.result).toBeNull();
    expect(button(changedUi, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
  }
  unmount("editor"); invoke(button(ui, "실습 준비로 돌아가기"), "onClick"); tree = parent();
  invoke(button(tree, "대상 수정으로 돌아가기"), "onClick"); tree = parent();
  change(input(tree, "API 경로"), "/api/changed"); tree = parent();
  // Returning to the original path must not resurrect its old server evidence either.
  change(input(tree, "API 경로"), "/api/search"); tree = parent();
  invoke(nodes(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true }, stopPropagation() {} }); tree = parent();
  invoke(nodes(tree).find(n => n.type === "form")!, "onSubmit", { preventDefault() {} }); tree = parent();
  invoke(button(tree, "SQLi 요청 편집기로 이동"), "onClick"); tree = parent();
  const reset = editor(nodes(tree).find(n => n.type === SqliRequestEditor)!);
  expect(nodes(reset).find(n => n.type === SqliResponseComparison)!.props.result).toBeNull();
});

it("aborts an active request on unmount and ignores a late response", async () => {
  const draft: SqliRequestDraft = { version: "sqli-practice-v1", connectionId: "a", repository: "org/app", commitSha: "sha", findingId: "f",
    target: { deploymentOrigin: "https://sandbox.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q" }, baseline: { value: "normal" }, test: { value: safeSqliProbe.value } };
  const save = vi.fn(); const element = { props: { initialDraft: draft, onBack() {}, onSessionChange: save } } as unknown as Element;
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true, expiresAt: new Date(Date.now() + 60000).toISOString(), remainingRequests: 2, approvalId: "approval", targetId: "target" }) });
  let ui = editor(element); invoke(button(ui, "서버 실행 승인 확인 · 대상 요청 없음"), "onClick");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); await Promise.resolve(); ui = editor(element);
  invoke(nodes(ui).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); ui = editor(element);
  let resolve!: (response: unknown) => void;
  fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  invoke(button(ui, "정상값·테스트값 요청 전송"), "onClick");
  const signal = fetcher.mock.calls[1][1].signal as AbortSignal;
  unmount("editor"); expect(signal.aborted).toBe(true); const count = save.mock.calls.length;
  resolve({ ok: true, json: async () => ({ allowed: true }) }); await Promise.resolve(); await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(count);
  const next = editor(element); expect(button(next, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
});

function standalone(session?: unknown) {
  const draft: SqliRequestDraft = { version: "sqli-practice-v1", connectionId: "a", repository: "org/app", commitSha: "a".repeat(40), findingId: "sqli:f",
    target: { deploymentOrigin: "https://sandbox.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q" }, baseline: { value: "normal" }, test: { value: safeSqliProbe.value } };
  return { draft, element: { props: { initialDraft: draft, session, onBack() {} } } as unknown as Element };
}
function observed(request: SqliRequestDraft, runId: string): SqliComparisonResult {
  const evidence = { requestId: "request", observedAt: new Date().toISOString(), outcome: "RESPONSE" as const, statusCode: 200, durationMs: 1, body: "normal", bodyTruncated: false, errorMessage: null };
  return { runId, request, baseline: evidence, test: { ...evidence, requestId: "test", statusCode: 500, body: "error" }, assessment: { status: "INCONCLUSIVE", reason: "HTTP only", evidenceReferences: [] } };
}
async function approve(element: Element) {
  const count = fetcher.mock.calls.length;
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true, expiresAt: new Date(Date.now() + 60000).toISOString(), remainingRequests: 2, approvalId: "approval", targetId: "target" }) });
  const ui = editor(element); const trigger = button(ui, "서버 실행 승인 확인 · 대상 요청 없음");
  invoke(trigger, "onClick"); invoke(trigger, "onClick");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(count + 1)); await Promise.resolve();
  let next = editor(element);
  invoke(nodes(next).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } });
  next = editor(element); return next;
}

it("prevents duplicate dispatch and preserves the first observation when a later pair arrives", async () => {
  const { draft, element } = standalone(); let ui: ReactNode = await approve(element);
  const first = observed(draft, "first-run"); fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ result: first }) });
  const trigger = button(ui, "정상값·테스트값 요청 전송"); invoke(trigger, "onClick"); invoke(trigger, "onClick");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); await Promise.resolve(); ui = editor(element);
  expect(nodes(ui).find(n => n.type === SqliResponseComparison)!.props.result).toBe(first);
  ui = await approve(element); const latest = observed(draft, "later-run"); fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ result: latest }) });
  invoke(button(ui, "정상값·테스트값 요청 전송"), "onClick"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4)); await Promise.resolve(); ui = editor(element);
  expect(text(ui)).toContain("first-run"); expect(text(ui)).toContain("later-run");
  const comparisons = nodes(ui).filter(n => n.type === SqliResponseComparison);
  expect(comparisons.map(n => n.props.result)).toEqual([latest, first]);
  change(input(ui, "정상 요청 입력값"), "changed"); ui = editor(element);
  expect(nodes(ui).filter(n => n.type === SqliResponseComparison).map(n => n.props.result)).toEqual([null]);
  expect(button(ui, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
});

it("keeps failed and mismatched results out of the evidence UI and never retries", async () => {
  const { draft, element } = standalone(); let ui: ReactNode = await approve(element);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ result: observed({ ...draft, commitSha: "b".repeat(40) }, "foreign-run") }) });
  invoke(button(ui, "정상값·테스트값 요청 전송"), "onClick"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); await Promise.resolve(); ui = editor(element);
  expect(nodes(ui).find(n => n.type === SqliResponseComparison)!.props.result).toBeNull();
  expect(nodes(ui).find(n => n.type === SqliResponseComparison)!.props.attempted).toBe(true);
  expect(text(ui)).toContain("일치하는 실제 결과"); expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockRejectedValueOnce(new Error("offline")); invoke(button(ui, "서버 실행 승인 확인 · 대상 요청 없음"), "onClick");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3)); await Promise.resolve(); ui = editor(element);
  expect(text(ui)).toContain("offline"); expect(button(ui, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
});

it("aborts an execution timeout without fabricating a response or automatically retrying", async () => {
  const { element } = standalone(); let ui: ReactNode = await approve(element); vi.useFakeTimers();
  fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("aborted")))));
  invoke(button(ui, "정상값·테스트값 요청 전송"), "onClick"); await vi.advanceTimersByTimeAsync(125001); ui = editor(element);
  expect(text(ui)).toContain("이미 전송됐을 수 있으므로 자동 재시도하지 않습니다");
  expect(nodes(ui).find(n => n.type === SqliResponseComparison)!.props.result).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("compares a previous commit only after explicit selection without restoring it as a current result", () => {
  const { draft, element } = standalone();
  const previous = observed({ ...draft, commitSha: "b".repeat(40) }, "previous-commit"); const current = observed(draft, "current-commit");
  hooks.history = { results: [previous, observed({ ...draft, connectionId: "other", commitSha: "c".repeat(40) }, "other-connection")], add: vi.fn() };
  element.props.session = { targetKey: sqliTargetKey(draft), baseline: draft.baseline.value, test: draft.test.value, result: current };
  let ui = editor(element);
  expect(nodes(ui).filter(n => n.type === SqliResponseComparison).map(n => n.props.result)).toEqual([current]);
  change(input(ui, "비교할 이전 커밋의 실행"), "previous-commit"); ui = editor(element);
  expect(nodes(ui).filter(n => n.type === SqliResponseComparison).map(n => n.props.result)).toEqual([current, previous]);
  expect(nodes(ui).filter(n => n.type === "option").map(n => n.props.value)).not.toContain("other-connection");
  expect(input(ui, "정상 요청 입력값").props.value).toBe(draft.baseline.value);
  expect(button(ui, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

function xssEditor(element: Element) {
  const wrapper = XssRequestEditor(element.props as Parameters<typeof XssRequestEditor>[0]);
  return render("editor", () => (wrapper.type as (p: unknown) => ReactNode)(wrapper.props));
}
function xssStandalone() {
  const draft: XssRequestDraft = { version: "xss-practice-v1", connectionId: "a", repository: "org/app", commitSha: "a".repeat(40), findingId: "xss:f", target: { deploymentOrigin: "https://sandbox.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q", reflectionLocation: "result text", reflectionContext: "HTML_TEXT" }, baseline: { value: safeXssProbe.baseline }, test: { value: safeXssProbe.value } };
  return { draft, element: { props: { initialDraft: draft, onBack() {}, recordContext: { recordKey: "xss-target-1", codeLocation: "route.ts:1", confirmedTarget: { apiPath: "/api/search", method: "GET", parameter: "q", inputLocation: "query", deploymentUrl: draft.target.deploymentOrigin, details: { "반영 위치": "result text", "예상 HTML 문맥": "HTML_TEXT" } } } } } as unknown as Element };
}
function xssObserved(draft: XssRequestDraft, runId: string): XssComparisonResult {
  const r = observed({ ...draft, version: "sqli-practice-v1" }, runId);
  return { ...r, request: draft, baseline: { ...r.baseline!, body: "<p>normal</p>", contentType: "text/html" }, test: { ...r.test!, statusCode: 200, body: `<p>${safeXssProbe.value}</p>`, contentType: "text/html" } };
}

it("requires XSS reflection confirmation, uses the existing target version and resets changed reflection locations", () => {
  const xssFinding = { ...finding, id: "xss:candidate", type: "XSS" } as PracticeFinding;
  const parent = () => render("parent", () => PracticeTargetEditor({ analysis, finding: xssFinding, baseUrl: "https://sandbox.vercel.app", ownership: true, connectionId: "connection-a" }));
  let tree = parent(); change(input(tree, "입력 위치"), "query"); tree = parent(); change(input(tree, "테스트 파라미터"), "q"); tree = parent();
  invoke(nodes(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true }, stopPropagation() {} }); tree = parent();
  expect(button(tree, "실습 준비 화면으로 이동").props.disabled).toBe(true);
  change(input(tree, "반영 위치"), "result text"); tree = parent(); change(input(tree, "예상 HTML 문맥"), "HTML_TEXT"); tree = parent();
  invoke(nodes(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true }, stopPropagation() {} }); tree = parent();
  invoke(nodes(tree).find(n => n.type === "form")!, "onSubmit", { preventDefault() {} }); tree = parent(); invoke(button(tree, "XSS 요청 편집기로 이동"), "onClick"); tree = parent();
  const element = nodes(tree).find(n => n.type === XssRequestEditor)!; const original = element.props.initialDraft as XssRequestDraft;
  const context = element.props.recordContext as { confirmedTarget: { details: Record<string, string> } }; expect(context.confirmedTarget.details["반영 위치"]).toBe("result text");
  const ui = xssEditor(element); expect(input(ui, "정상 요청 입력값").props.readOnly).toBe(true); expect(input(ui, "테스트 요청 입력값").props.value).toBe(safeXssProbe.value);
  invoke(button(ui, "실습 준비로 돌아가기"), "onClick"); unmount("editor"); tree = parent(); invoke(button(tree, "대상 수정으로 돌아가기"), "onClick"); tree = parent();
  change(input(tree, "반영 위치"), "another element"); tree = parent();
  expect(button(tree, "실습 준비 화면으로 이동").props.disabled).toBe(true);
  expect(xssTargetKey(original)).not.toBe(xssTargetKey({ ...original, target: { ...original.target, reflectionLocation: "another element" } }));
  expect(fetcher).not.toHaveBeenCalled();
});

it("retains independent XSS commit observations only as explicit references and connects XSS manual notes", () => {
  const { draft, element } = xssStandalone(); const current = xssObserved(draft, "xss-current"); const previous = xssObserved({ ...draft, commitSha: "b".repeat(40) }, "xss-previous");
  hooks.xssHistory = { results: [previous], add: vi.fn() }; element.props.session = { targetKey: xssTargetKey(draft), baseline: draft.baseline.value, test: draft.test.value, result: current };
  let ui = xssEditor(element); expect(nodes(ui).filter(n => n.type === XssResponseComparison).map(n => n.props.result)).toEqual([current]);
  change(input(ui, "비교할 이전 커밋의 실행"), previous.runId); ui = xssEditor(element);
  expect(nodes(ui).filter(n => n.type === XssResponseComparison).map(n => n.props.result)).toEqual([current, previous]);
  invoke(button(ui, "검사 결과 기록으로 이동"), "onClick"); ui = xssEditor(element);
  const manual = nodes(ui).find(n => n.type === SecurityTestRecord)!; expect(manual.props.kind).toBe("XSS"); expect(manual.props.recordKey).toBe("xss-target-1");
  expect(manual.props.observations).toMatchObject({ initial: expect.stringContaining("xss-previous"), latest: expect.stringContaining("xss-current") });
  unmount("editor"); const changed = xssEditor({ ...element, props: { ...element.props, initialDraft: { ...draft, target: { ...draft.target, reflectionContext: "HTML_ATTRIBUTE" } } } });
  expect(nodes(changed).find(n => n.type === XssResponseComparison)!.props.result).toBeNull(); expect(button(changed, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
});

it("sends XSS only to the authenticated internal API, suppresses duplicate dispatch and ignores late execution responses", async () => {
  const { draft, element } = xssStandalone(); let ui = xssEditor(element);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true, expiresAt: new Date(Date.now() + 60000).toISOString(), remainingRequests: 2, approvalId: "xss-grant", targetId: "xss-target" }) });
  const trigger = button(ui, "서버 실행 승인 확인 · 대상 요청 없음"); invoke(trigger, "onClick"); invoke(trigger, "onClick"); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); await Promise.resolve(); ui = xssEditor(element);
  expect(fetcher.mock.calls[0][0]).toBe("/api/repositories/a/practice/xss");
  invoke(nodes(ui).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); ui = xssEditor(element);
  let resolve!: (value: unknown) => void; fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const send = button(ui, "정상값·테스트값 요청 전송"); invoke(send, "onClick"); invoke(send, "onClick");
  expect(fetcher).toHaveBeenCalledTimes(2); const signal = fetcher.mock.calls[1][1].signal as AbortSignal;
  unmount("editor"); expect(signal.aborted).toBe(true); resolve({ ok: true, json: async () => ({ result: xssObserved(draft, "too-late") }) }); await Promise.resolve(); await Promise.resolve();
  const next = xssEditor(element); expect(nodes(next).find(n => n.type === XssResponseComparison)!.props.result).toBeNull(); expect(button(next, "테스트 실행 환경 연결 전").props.disabled).toBe(true);
});
