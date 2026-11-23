import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { canRecordManualRetest, emptySecurityRecord, validateManualRetest, type SecurityRecordDraft, type SecurityRecordKind } from "@/types/securityTestRecord";
import type { SqliComparisonResult } from "@/lib/security-lab/sqliTypes";

const hooks = vi.hoisted(() => ({ scope: "root", cursor: 0, slots: new Map<string, unknown[]>(), context: null as unknown }));
function scoped<T>(scope: string, render: () => T): T {
  const oldScope = hooks.scope, oldCursor = hooks.cursor; hooks.scope = scope; hooks.cursor = 0;
  try { return render(); } finally { hooks.scope = oldScope; hooks.cursor = oldCursor; }
}
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++, values = hooks.slots.get(hooks.scope) ?? []; hooks.slots.set(hooks.scope, values);
    if (values.length <= index) values.push(typeof initial === "function" ? initial() : initial);
    return [values[index], (value: unknown) => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
  },
  useContext: () => hooks.context, useCallback: (fn: unknown) => fn, useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
}));
import { SecurityTargetRecords, SecurityTestRecord, SecurityTestRecordProvider } from "./SecurityTestRecord";
import { ManualSecurityTarget } from "./ManualSecurityTarget";
import { SqliResponseComparison } from "./SqliRequestEditor";
import { PracticeTargetEditor } from "./PracticeTargetEditor";
import { AccessComparison } from "./AccessComparison";
import { accessPlanFromTarget, emptyAccessComparison } from "@/lib/security-lab/manualAccess";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { AccessControlFinding, SqlInjectionFinding } from "@/types/security";
import { confirmPracticeTarget, emptyTargetHistory, practiceRecordKey, type ConfirmedPracticeTarget } from "@/types/securityPracticeTarget";

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Record<string, unknown>>(node) ? [node, ...elements(node.props.children as ReactNode)] : [];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : "";
}
function get(tree: ReactNode, type: string, label?: string): Element {
  const found = elements(tree).find(element => element.type === type && (label === undefined || text(element.props.children as ReactNode) === label));
  if (!found) throw new Error(`Missing ${type}: ${label}`); return found;
}
function field(tree: ReactNode, label: string): Element {
  const wrapper = elements(tree).find(element => element.type === "label" && text(element.props.children as ReactNode).startsWith(label));
  const input = wrapper && elements(wrapper.props.children as ReactNode).find(element => ["input", "textarea", "select"].includes(String(element.type)));
  if (!input) throw new Error(`Missing field ${label}`); return input;
}
function invoke(node: Element, event: string, argument?: unknown) {
  const fn = node.props[event]; if (typeof fn !== "function") throw new Error(`Missing ${event}`); fn(argument);
}
function unwrap(node: ReactNode): ReactNode {
  if (isValidElement<Record<string, unknown>>(node) && typeof node.type === "function") return unwrap((node.type as (props: Record<string, unknown>) => ReactNode)(node.props));
  return node;
}
function manual(kind: SecurityRecordKind): ReactNode {
  const provider = scoped("provider", () => SecurityTestRecordProvider({ children: null }));
  hooks.context = provider.props.value;
  return scoped(`record:${kind}`, () => unwrap(SecurityTestRecord({ source: "MANUAL", recordKey: `test:${kind}`, kind,
    initial: { apiPath: `/api/${kind.toLowerCase()}`, method: "GET", codeLocation: "route.ts:10" } })));
}
beforeEach(() => {
  hooks.scope = "root"; hooks.cursor = 0; hooks.slots.clear(); hooks.context = null; vi.stubGlobal("fetch", vi.fn());
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 18, 13, 0));
});

it("imports HTTP summaries only as user notes without promoting a verdict or completing retesting", () => {
  const withNotes = () => {
    hooks.context = scoped("provider", () => SecurityTestRecordProvider({ children: null })).props.value;
    return scoped("notes", () => unwrap(SecurityTestRecord({ source: "MANUAL", kind: "SQL_INJECTION", recordKey: "same-confirmed-target",
      initial: { apiPath: "/api/search", method: "GET" }, observations: { initial: "first-run HTTP summary", latest: "later-run HTTP summary" } })));
  };
  let tree = withNotes(); invoke(get(tree, "button", "최초 HTTP 관찰 요약을 수동 메모로 복사"), "onClick"); tree = withNotes();
  expect(field(tree, "수정 전 관찰 내용").props.value).toBe("first-run HTTP summary");
  invoke(get(tree, "button", "후속 HTTP 관찰 요약을 수동 메모로 복사"), "onClick"); tree = withNotes();
  expect(field(tree, "수정 후 관찰 내용").props.value).toBe("later-run HTTP summary");
  expect(field(tree, "검사 상태").props.value).toBe("NOT_RUN"); expect(field(tree, "수정 후 검사 상태").props.value).toBe("NOT_RUN");
  expect(elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!.props.checked).toBe(false);
  expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(true);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("rechecks the event time before completing a record when the displayed clock is stale", () => {
  let tree = manual("SQL_INJECTION");
  for (const [label, value] of Object.entries({ "검사 방법": "manual comparison", "수정 전 관찰 내용": "before",
    "수정한 파일": "route.ts", "수정 내용 메모": "binding", "재검증 수행 일시": "2026-11-18T12:00",
    "재검증 방법": "same comparison", "수정 후 관찰 내용": "after", "수정 후 검사 상태": "INCONCLUSIVE" })) {
    invoke(field(tree, label), "onChange", { target: { value } }); tree = manual("SQL_INJECTION");
  }
  const checkbox = elements(tree).find(element => element.type === "input" && element.props.type === "checkbox")!;
  invoke(checkbox, "onChange", { target: { checked: true } }); tree = manual("SQL_INJECTION");
  expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(false);
  vi.setSystemTime(new Date(2026, 10, 18, 11, 59));
  invoke(get(tree, "button", "수동 재검증 결과 기록 완료"), "onClick"); tree = manual("SQL_INJECTION");
  expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(true);
  expect(renderToStaticMarkup(tree)).not.toContain("사용자 수행 결과 기록 완료");
  expect(renderToStaticMarkup(tree)).toContain("미래일 수 없습니다");
});

it("keeps all four manual records separate and requires a performance declaration before completing a retest record", () => {
  // Pure validation regression cases share an explicit clock; no native-input validation is assumed.
  const valid: SecurityRecordDraft = { ...emptySecurityRecord({ apiPath: "/api/orders/101", method: "GET" }), status: "OBSERVED",
    inspectionMethod: "계정 A/B 비교", beforeObservation: "다른 계정 데이터 노출 관찰", changedFiles: "route.ts", changes: "소유권 확인 추가",
    performedManually: true, performedAt: "2026-11-18T12:00", retestMethod: "동일 계정 조건 비교", afterObservation: "접근 거부 관찰", afterStatus: "NOT_OBSERVED" };
  const now = Date.now();
  expect(validateManualRetest(valid, now)).toMatchObject({ valid: true, errors: {} });
  expect(canRecordManualRetest(valid, now)).toBe(true);
  const invalid: Partial<SecurityRecordDraft>[] = [
    { apiPath: "" }, { apiPath: "   " }, { apiPath: "https://example.invalid/api/orders" }, { apiPath: "//example.invalid/api" },
    { apiPath: "/api/orders?q=x" }, { apiPath: "/api/%0a" }, { apiPath: "/api/%zz" }, { apiPath: "/api/../orders" },
    { method: "" }, { method: "   " }, { method: "TRACE" }, { method: "get" }, { method: "GET " },
    { inspectionMethod: "" }, { inspectionMethod: " \n\t" }, { beforeObservation: "   " },
    { performedAt: "" }, { performedAt: "   " }, { performedAt: "not-a-date" }, { performedAt: "2026-11-18" },
    { performedAt: "2026-02-30T12:00" }, { performedAt: "2025-02-29T12:00" }, { performedAt: "2026-04-31T12:00" },
    { performedAt: "2026-11-18T24:00" }, { performedAt: "2026-11-18T12:60" }, { performedAt: "2026-11-18T12:00:60" },
    { performedAt: "2026-11-18T13:00:01" }, { performedAt: "2027-01-01T12:00" },
    { performedManually: false }, { retestMethod: "   " }, { afterObservation: " \n" }, { changedFiles: "   " }, { changes: "   " }, { afterStatus: "NOT_RUN" },
  ];
  for (const change of invalid) {
    const draft = { ...valid, ...change };
    expect(validateManualRetest(draft, now).valid, JSON.stringify(change)).toBe(false);
    expect(canRecordManualRetest(draft, now), JSON.stringify(change)).toBe(false);
    expect(validateManualRetest({ ...draft, retestStatus: "RECORDED" }, now).retestStatus, JSON.stringify(change)).toBe("PLANNED");
  }
  expect(canRecordManualRetest({ ...valid, performedAt: "2024-02-29T12:00" }, now)).toBe(true);
  expect(canRecordManualRetest({ ...valid, performedAt: "2026-11-18T13:00" }, now)).toBe(true);
  expect(validateManualRetest(valid, Number.NaN).valid).toBe(false);
  for (const kind of ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"] as const) {
    let tree = manual(kind);
    invoke(field(tree, "수정 전 관찰 내용"), "onChange", { target: { value: `${kind}: before` } }); tree = manual(kind);
    invoke(field(tree, "검사 상태"), "onChange", { target: { value: "OBSERVED" } });
    const markup = renderToStaticMarkup(manual(kind));
    expect(markup).toContain("출처: 사용자 수동 기록"); expect(markup).toContain("서버 검증 근거 없음 · 판정 불가");
  }
  let tree = manual("IDOR"); expect(field(tree, "수정 전 관찰 내용").props.value).toBe("IDOR: before");
  expect(field(manual("XSS"), "수정 전 관찰 내용").props.value).toBe("XSS: before");
  tree = manual("IDOR");
  const values = { "검사 방법": "계정 A/B 수동 비교", "수정한 파일": "app/api/orders/route.ts", "수정 내용 메모": "객체 소유권 조건 추가",
    "재검증 수행 일시": "2026-11-18T12:00", "재검증 방법": "별도 테스트 환경에서 동일 조건 확인", "수정 후 관찰 내용": "다른 계정의 접근 거부 관찰", "사용자 메모": "<script>note</script>" };
  for (const [label, value] of Object.entries(values)) { invoke(field(tree, label), "onChange", { target: { value } }); tree = manual("IDOR"); }
  invoke(field(tree, "수정 후 검사 상태"), "onChange", { target: { value: "NOT_OBSERVED" } }); tree = manual("IDOR");
  expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(true);
  invoke(get(tree, "button", "수동 재검증 결과 기록 완료"), "onClick");
  expect(renderToStaticMarkup(manual("IDOR"))).not.toContain("재검증 기록 상태: 결과 기록 완료");
  tree = manual("IDOR"); const checkbox = elements(tree).find(element => element.type === "input" && element.props.type === "checkbox")!;
  invoke(checkbox, "onChange", { target: { checked: true } }); tree = manual("IDOR");
  expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(false);
  invoke(get(tree, "button", "수동 재검증 결과 기록 완료"), "onClick"); tree = manual("IDOR");
  let markup = renderToStaticMarkup(tree);
  expect(markup).toContain("사용자 수행 결과 기록 완료 · 서버 미검증"); expect(markup).toContain("IDOR: before");
  expect(markup).toContain("다른 계정의 접근 거부 관찰"); expect(markup).toContain("&lt;script&gt;note&lt;/script&gt;"); expect(markup).not.toContain("<script>");
  manual("AUTHORIZATION"); tree = manual("IDOR"); // A different record / screen never resets this record's view or text.
  expect(renderToStaticMarkup(tree)).toContain("수정 전후 결과 비교");
  invoke(get(tree, "button", "기록 수정으로 돌아가기"), "onClick"); tree = manual("IDOR");
  for (const [label, restored] of [["검사 대상 API", "/api/idor"], ["HTTP 메서드", "GET"], ["검사 방법", "계정 A/B 수동 비교"]]) {
    invoke(field(tree, label), "onChange", { target: { value: "" } }); tree = manual("IDOR");
    expect(renderToStaticMarkup(tree)).toContain("재검증 기록 상태: 진행 예정");
    expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(true);
    invoke(field(tree, label), "onChange", { target: { value: restored } }); tree = manual("IDOR");
    const confirm = elements(tree).find(element => element.type === "input" && element.props.type === "checkbox")!;
    invoke(confirm, "onChange", { target: { checked: true } }); tree = manual("IDOR");
    expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(false);
    invoke(get(tree, "button", "수동 재검증 결과 기록 완료"), "onClick"); tree = manual("IDOR");
    invoke(get(tree, "button", "기록 수정으로 돌아가기"), "onClick"); tree = manual("IDOR");
  }
  invoke(field(tree, "수정한 파일"), "onChange", { target: { value: "another.ts" } }); tree = manual("IDOR");
  markup = renderToStaticMarkup(tree); expect(markup).toContain("재검증 기록 상태: 진행 예정");
  expect(get(tree, "button", "수동 재검증 결과 기록 완료").props.disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
});

it("links manual preparation to recording and keeps server evidence read-only without importing it into manual notes", () => {
  const prep = () => scoped("prep", () => ManualSecurityTarget({ kind: "AUTHORIZATION" }));
  let tree = prep();
  for (const [label, value] of Object.entries({ "검사 대상 API 경로": "/api/admin", "검사 목적": "역할 검사", "기대 동작": "일반 사용자 거부",
    "보호 대상 기능": "관리자 통계", "필요한 역할": "admin", "허용되어야 하는 역할": "admin", "거부되어야 하는 역할": "user" })) {
    invoke(field(tree, label), "onChange", { target: { value } }); tree = prep();
  }
  invoke(elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); tree = prep();
  invoke(get(tree, "form"), "onSubmit", { preventDefault: vi.fn() }); tree = prep();
  invoke(get(tree, "button", "검사 결과 기록으로 이동"), "onClick"); tree = prep();
  const linked = elements(tree).find(element => element.type === SecurityTargetRecords)!;
  const records = scoped("linked", () => SecurityTargetRecords(linked.props as Parameters<typeof SecurityTargetRecords>[0]));
  const entry = elements(records).find(element => element.type === SecurityTestRecord)!;
  expect(entry.props).toMatchObject({ source: "MANUAL", kind: "AUTHORIZATION", initial: { apiPath: "/api/admin", method: "GET" } });
  expect(entry.props.confirmedTarget).toMatchObject({ details: { "필요 역할": "admin", "거부 역할": "user" } });
  const idorPrep = () => scoped("idor-prep", () => ManualSecurityTarget({ kind: "IDOR" }));
  let idor = idorPrep();
  for (const [label, value] of Object.entries({ "검사 대상 API 경로": "/api/orders/101", "검사 목적": "소유권 확인", "기대 동작": "다른 계정 거부",
    "객체 식별자": "101", "계정 B 소유 리소스 식별자": "202", "리소스 식별자 위치": "path id", "테스트 계정 A": "owner-A", "테스트 계정 B": "other-B" })) {
    invoke(field(idor, label), "onChange", { target: { value } }); idor = idorPrep();
  }
  invoke(elements(idor).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); idor = idorPrep();
  invoke(get(idor, "form"), "onSubmit", { preventDefault() {} }); idor = idorPrep();
  const idorLinked = elements(idor).find(element => element.type === SecurityTargetRecords)!;
  const idorRecords = scoped("idor-linked", () => SecurityTargetRecords(idorLinked.props as Parameters<typeof SecurityTargetRecords>[0]));
  expect(elements(idorRecords).find(element => element.type === SecurityTestRecord)!.props).toMatchObject({
    source: "MANUAL", kind: "IDOR", initial: { apiPath: "/api/orders/101", method: "GET" },
    confirmedTarget: { details: { "객체 식별자 A": "101", "객체 식별자 B": "202", "소유 계정 A": "owner-A", "소유 계정 B": "other-B" } },
  });
  const result: SqliComparisonResult = { runId: "server-run", request: { version: "sqli-practice-v1", connectionId: "c", repository: "org/app", commitSha: "a".repeat(40), findingId: "sqli:1",
    target: { deploymentOrigin: "https://fixture.vercel.app", apiPath: "/api/search", method: "GET", inputLocation: "query", parameter: "q" }, baseline: { value: "normal" }, test: { value: "test" } },
    baseline: { requestId: "server-normal", observedAt: "2026-11-18T00:00:00Z", outcome: "RESPONSE", statusCode: 200, durationMs: 10, body: "server-only-evidence", bodyTruncated: false, errorMessage: null },
    test: { requestId: "server-test", observedAt: "2026-11-18T00:00:01Z", outcome: "TIMEOUT", statusCode: null, durationMs: 8000, body: null, bodyTruncated: false, errorMessage: "timeout" },
    assessment: { status: "INCONCLUSIVE", reason: "insufficient proof", evidenceReferences: [] } };
  const original = JSON.stringify(result);
  const server = scoped("server", () => unwrap(SecurityTestRecord({ source: "SERVER", result })));
  const markup = renderToStaticMarkup(server);
  expect(markup).toContain("출처 · 서버 HTTP 관찰"); expect(markup).toContain("server-run"); expect(markup).toContain("server-test"); expect(markup).toContain("판정 불가");
  expect(elements(server).filter(element => ["input", "textarea", "select"].includes(String(element.type)))).toHaveLength(0);
  expect(JSON.stringify(result)).toBe(original);
  const comparison = renderToStaticMarkup(SqliResponseComparison({ result }));
  expect(comparison).toContain("server-only-evidence"); expect(comparison).toContain("서버 HTTP 관찰");
  const manualSql = manual("SQL_INJECTION"); expect(field(manualSql, "수정 전 관찰 내용").props.value).toBe("");
  expect(field(manualSql, "검사 상태").props.value).toBe("NOT_RUN"); expect(fetch).not.toHaveBeenCalled();
});

it("uses only confirmed targets, preserves target revisions and restores preparation state after candidate navigation", () => {
  const finding: SqlInjectionFinding = { id: "candidate", type: "SQL_INJECTION", filePath: "route.ts", line: 2, endLine: 2,
    severity: "HIGH", confidence: "HIGH", relationship: "suspected", sink: "db.query", code: "db.query(input)", evidence: [], reason: "fixture", remediation: "fixture", limitations: [], runtimeExploitation: "not-tested" };
  const analysis: RepositoryAnalysis = { repository: "org/app", files: [{ path: "route.ts", name: "route.ts", sourceCode: "code", imports: [],
    functions: [{ id: "handler", name: "GET", filePath: "route.ts", line: 1, endLine: 5, kind: "function", nodeType: "api", calls: [], componentReferences: [], callbackReferences: [], sourceCode: "code" }] }],
    entryPoints: [{ kind: "api", framework: "next-app", filePath: "route.ts", routePath: "/api/ast", method: "GET", nodeId: "handler" }],
    nodes: [], edges: [], stats: { files: 1, functions: 1, relations: 0 } };
  const context = () => { hooks.context = scoped("target-provider", () => SecurityTestRecordProvider({ children: null })).props.value; };
  const prep = () => { context(); return scoped("target-editor", () => PracticeTargetEditor({ analysis, finding, baseUrl: "https://sandbox.vercel.app", ownership: true, connectionId: "connection" })); };
  const scope = "finding:SQL_INJECTION:candidate";
  const records = () => { context(); return scoped("target-records", () => SecurityTargetRecords({ scope, kind: "SQL_INJECTION", suggestion: { path: "/api/ast", method: "GET" } })); };
  let tree = records(); expect(renderToStaticMarkup(tree)).toContain("검사 대상 미확정");
  expect(renderToStaticMarkup(tree)).toContain("AST 제안 (사용자 확정 아님)");
  expect(elements(tree).filter(n => n.type === SecurityTestRecord)).toHaveLength(0);
  tree = prep();
  for (const [label, value] of Object.entries({ "API 경로": "/api/user-confirmed", "HTTP 메서드": "POST", "입력 위치": "JSON body", "테스트 파라미터": "search" })) {
    invoke(field(tree, label), "onChange", { target: { value } }); tree = prep();
  }
  const confirm = () => {
    tree = prep(); const checkbox = elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!;
    invoke(checkbox, "onChange", { target: { checked: true }, stopPropagation() {} }); tree = prep();
    invoke(get(tree, "form"), "onSubmit", { preventDefault() {} }); tree = prep();
  };
  confirm(); tree = records();
  const first = elements(tree).find(n => n.type === SecurityTestRecord)!;
  expect(first.props).toMatchObject({ source: "MANUAL", initial: { apiPath: "/api/user-confirmed", method: "POST" }, confirmedTarget: {
    inputLocation: "JSON body", parameter: "search", deploymentUrl: "https://sandbox.vercel.app" } });
  const record = (entry: Element) => { context(); return scoped(String(entry.props.recordKey), () => unwrap(SecurityTestRecord(entry.props as Parameters<typeof SecurityTestRecord>[0]))); };
  let form = record(first); expect(field(form, "검사 대상 API").props.readOnly).toBe(true);
  expect(field(form, "HTTP 메서드").props.disabled).toBe(true);
  invoke(field(form, "수정 전 관찰 내용"), "onChange", { target: { value: "old target observation" } });
  form = record(first); invoke(field(form, "검사 대상 API"), "onChange", { target: { value: "/api/forbidden-edit" } });
  expect(field(record(first), "검사 대상 API").props.value).toBe("/api/user-confirmed");
  // Simulate unmounting the candidate preparation component, keeping the analysis Provider alive.
  hooks.slots.delete("target-editor"); tree = prep(); expect(renderToStaticMarkup(tree)).toContain("실습 준비 · 취약점 후보");
  invoke(get(tree, "button", "대상 수정으로 돌아가기"), "onClick"); tree = prep();
  expect(field(tree, "API 경로").props.value).toBe("/api/user-confirmed");
  invoke(field(tree, "테스트 파라미터"), "onChange", { target: { value: "different" } });
  tree = records(); expect(renderToStaticMarkup(tree)).toContain("검사 대상 미확정");
  expect(elements(tree).find(n => n.type === "fieldset")!.props.disabled).toBe(true);
  confirm(); tree = records(); const entries = elements(tree).filter(n => n.type === SecurityTestRecord);
  expect(entries).toHaveLength(2); expect(entries[0].props.recordKey).not.toBe(first.props.recordKey);
  expect(field(record(entries[0]), "수정 전 관찰 내용").props.value).toBe("");
  expect(field(record(entries[0]), "검사 상태").props.value).toBe("NOT_RUN");
  expect(field(record(entries[1]), "수정 전 관찰 내용").props.value).toBe("old target observation");
  for (const key of ["apiPath", "method", "inputLocation", "parameter", "deploymentUrl"] as const) {
    const original = { apiPath: "/api/a", method: "GET", inputLocation: "query", parameter: "q", deploymentUrl: "https://sandbox.vercel.app" };
    const history = confirmPracticeTarget(emptyTargetHistory, original);
    const changed = confirmPracticeTarget(history, { ...original, [key]: "different" });
    expect(changed.versions).toHaveLength(2); expect(practiceRecordKey(scope, changed.activeId!)).not.toBe(practiceRecordKey(scope, history.activeId!));
  }
  for (const kind of ["IDOR", "AUTHORIZATION"] as const) {
    const original: ConfirmedPracticeTarget = { apiPath: "/api/manual", method: "GET", inputLocation: "", parameter: "", details: kind === "IDOR" ? { account: "owner-a" } : { role: "admin" } };
    const history = confirmPracticeTarget(emptyTargetHistory, original);
    expect(confirmPracticeTarget(history, { ...original, details: { ...original.details, changed: "other account or role" } }).versions).toHaveLength(2);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])("preserves manual comparison drafts and archives changed resources (static candidate: %s)", linkedCandidate => {
  const candidate: AccessControlFinding | undefined = linkedCandidate ? {
    id: "idor:access-control-static-v1:candidate", type: "IDOR", filePath: "app/api/items/route.ts", line: 8, endLine: 9,
    api: {path:"/api/items/[id]",method:"GET",filePath:"app/api/items/route.ts",relation:"confirmed"},
    ownerFunctionId:"handler",functionName:"GET",operationRelation:"confirmed",reviewState:"UNCONFIRMED",assessment:"STATIC_REVIEW_ONLY",
    severity:"MEDIUM",confidence:"MEDIUM",relationship:"input-flow-observed",sink:"db.item.findUnique",code:"code",reason:"review",remediation:"review",
    evidence:[],checks:[],inputSources:[],callPath:[],manualChecks:[],limitations:[],runtimeExploitation:"not-tested",
  } : undefined;
  const context = () => { hooks.context = scoped("access-provider", () => SecurityTestRecordProvider({ children: null, persistence: { repositoryFullName: "org/repo", commitSha: "a".repeat(40) } })).props.value; };
  const prep = () => { context(); return scoped("access-reg", () => ManualSecurityTarget({ kind: "IDOR", candidate })); };
  let tree = prep();
  if (candidate) {
    expect(field(tree,"검사 대상 API 경로").props.value).toBe(candidate.api!.path);
    expect(field(tree,"테스트 계정 A").props.value).toBe("");
    expect(elements(tree).find(n=>n.type==="input"&&n.props.type==="checkbox")!.props.checked).toBe(false);
    expect(get(tree,"button","준비 화면으로 이동").props.disabled).toBe(true);
  }
  for (const [label, value] of Object.entries({ "검사 대상 API 경로": "/api/items/[id]", "검사 목적": "cross account comparison", "기대 동작": "owner only", "객체 식별자": "item-101", "계정 B 소유 리소스 식별자": "item-202", "리소스 식별자 위치": "path id", "테스트 계정 A": "account-A", "테스트 계정 B": "account-B" })) { invoke(field(tree, label), "onChange", { target: { value } }); tree = prep(); }
  const confirm = () => { tree = prep(); invoke(elements(tree).find(n => n.type === "input" && n.props.type === "checkbox")!, "onChange", { target: { checked: true } }); tree = prep(); invoke(get(tree, "form"), "onSubmit", { preventDefault() {} }); tree = prep(); };
  confirm(); invoke(get(tree, "button", "검사 결과 기록으로 이동"), "onClick"); tree = prep();
  const records = () => { tree = prep(); const linked = elements(tree).find(n => n.type === SecurityTargetRecords)!; context(); return scoped("access-records", () => SecurityTargetRecords(linked.props as Parameters<typeof SecurityTargetRecords>[0])); };
  const record = (entry: Element) => { context(); return scoped(String(entry.props.recordKey), () => unwrap(SecurityTestRecord(entry.props as Parameters<typeof SecurityTestRecord>[0]))); };
  const first = elements(records()).find(n => n.type === SecurityTestRecord)!;
  const target = first.props.confirmedTarget as ConfirmedPracticeTarget, plan = accessPlanFromTarget(target, "IDOR")!;
  if (candidate) {
    expect(target.details).toMatchObject({"정적 후보 ID":candidate.id,"정적 코드 위치":"app/api/items/route.ts:8–9"});
    expect(first.props.initial).toMatchObject({codeLocation:"app/api/items/route.ts:8–9"});
  }
  const comparison = emptyAccessComparison(target, plan, "a".repeat(40)); comparison.initial.observations.A_OTHER.responseSummary = "old resource observation";
  let form = record(first); invoke(elements(form).find(n => n.type === AccessComparison)!, "onChange", comparison);
  form = record(first); expect(elements(form).find(n => n.type === AccessComparison)!.props.value).toMatchObject({ initial: { observations: { A_OTHER: { responseSummary: "old resource observation" } } } });
  tree = prep(); const linked = elements(tree).find(n => n.type === SecurityTargetRecords)!; invoke(linked, "onBack"); tree = prep(); invoke(get(tree, "button", "수정 화면으로 돌아가기"), "onClick"); tree = prep();
  invoke(field(tree, "계정 B 소유 리소스 식별자"), "onChange", { target: { value: "item-303" } }); tree = prep();
  expect(elements(records()).find(n => n.type === SecurityTestRecord)!.props.readOnly).toBe(true);
  confirm(); const entries = elements(records()).filter(n => n.type === SecurityTestRecord); expect(entries).toHaveLength(2); expect(entries[0].props.recordKey).not.toBe(first.props.recordKey);
  expect(elements(record(entries[0])).find(n => n.type === AccessComparison)!.props.value).toBeUndefined();
  form = record(entries[1]); const archived = elements(form).find(n => n.type === AccessComparison)!; expect(archived.props.readOnly).toBe(true);
  const changed = structuredClone(comparison); changed.initial.observations.A_OTHER.responseSummary = "forbidden overwrite"; invoke(archived, "onChange", changed);
  expect(elements(record(entries[1])).find(n => n.type === AccessComparison)!.props.value).toEqual(comparison);
  hooks.slots.delete("access-reg"); tree = prep(); invoke(get(tree, "button", "수정 화면으로 돌아가기"), "onClick"); tree = prep();
  expect(field(tree, "계정 B 소유 리소스 식별자").props.value).toBe("item-303"); expect(fetch).not.toHaveBeenCalled();
});
