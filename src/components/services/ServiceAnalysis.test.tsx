import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/vercel/connectionEvents", () => ({ notifyVercelChanged: vi.fn() }));
import { ServiceAnalysis } from "./ServiceAnalysis";
import { SqlInjectionFindings } from "@/components/repository/SqlInjectionFindings";
import { SecurityTestRecordProvider } from "@/components/repository/SecurityTestRecord";
import { retainServiceAnalysis, serviceAnalysisIdentity } from "@/types/serviceAnalysisSession";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { SecurityRecordDraft } from "@/types/securityTestRecord";

const hooks = vi.hoisted(() => ({ scope: "root", cursor: 0, slots: new Map<string, unknown[]>(), refresh: vi.fn(), effects: [] as (() => (() => void))[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => (() => void)) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = hooks.cursor++, slots = hooks.slots.get(hooks.scope)!;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++, slots = hooks.slots.get(hooks.scope)!;
    return slots[index] ?? (slots[index] = { current: initial });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
type Element = ReactElement<Record<string, unknown>>;
function scoped<T>(scope: string, fn: () => T): T {
  hooks.scope = scope; hooks.cursor = 0; if (!hooks.slots.has(scope)) hooks.slots.set(scope, []); return fn();
}
function render(): ReactNode {
  const wrapper = ServiceAnalysis({ connectionId: "connection-a", status: "COMPLETED" });
  return scoped("root", () => (wrapper.type as (props: unknown) => ReactNode)(wrapper.props));
}
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : [];
}
function analyze(tree: ReactNode): Promise<void> { return (nodes(tree).find(n => n.type === "button")!.props.onClick as () => Promise<void>)(); }
function panels(tree: ReactNode) { return nodes(tree).filter(n => n.type === "section" && ["현재 분석 기록", "이전 분석 기록"].includes(String(n.props["aria-label"]))); }
function findings(tree: ReactNode) { return nodes(tree).filter(n => n.type === SqlInjectionFindings); }
function provider(id: string, archived = false) { return scoped(id, () => SecurityTestRecordProvider({ children: null, archived })); }
const initial: RepositoryAnalysis = {
  repository: "org/app", source: "github", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 },
  collection: { source: "github", commitSha: "a".repeat(40), discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, durationMs: 1, partial: false },
  sqlInjection: { version: "sqli-static-v1", findings: [{ id: "sqli:1", type: "SQL_INJECTION", severity: "HIGH", confidence: "HIGH",
    relationship: "suspected", filePath: "route.ts", line: 1, endLine: 1, sink: "db.query", code: "db.query(input)", evidence: [],
    reason: "fixture", remediation: "fixture", limitations: [], runtimeExploitation: "not-tested" }], truncated: false, limitations: [] },
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { hooks.slots.clear(); hooks.effects.length = 0; hooks.refresh.mockClear(); fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

function analysisCalls() { return fetcher.mock.calls.filter(([url]) => String(url).endsWith("/analyze")); }
function analysisButton() { return nodes(render()).find(n => n.type === "button")!; }
async function prepareInitialAnalysis() {
  fetcher.mockResolvedValueOnce(Response.json({ analysis: null })); render(); hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.slots.get("root")).toContain("empty"));
}
async function checkLatest(sha = "f".repeat(40)) {
  fetcher.mockResolvedValueOnce(Response.json({ repository: "org/app", branch: "main", sha }));
  render(); hooks.effects.at(-1)!();
  await vi.waitFor(() => expect(analysisButton().props.disabled).toBe(sha === (findings(render())[0]?.props.analysis as RepositoryAnalysis)?.collection?.commitSha));
}

it("automatically restores durable results on entry and remount without triggering analysis", async () => {
  for (let visit = 0; visit < 2; visit++) {
    hooks.slots.clear(); hooks.effects.length = 0;
    fetcher.mockResolvedValueOnce(Response.json({ analysis: { ...initial, analyzedAt: "2026-11-24T00:00:00Z" } }));
    render(); const cleanup = hooks.effects[0]();
    await vi.waitFor(() => expect(findings(render())).toHaveLength(1));
    expect(findings(render())[0].props.analysis).toMatchObject({ collection: { commitSha: initial.collection!.commitSha } });
    cleanup();
  }
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/analysis"))).toBe(true);
});

it("distinguishes no saved result from a read failure and permits read-only retry", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ analysis: null })); render(); hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.slots.get("root")).toContain("empty"));
  expect(panels(render())).toHaveLength(0);
  hooks.slots.clear(); hooks.effects.length = 0;
  fetcher.mockResolvedValueOnce(Response.json({ message: "조회 실패" }, { status: 503 })); render(); hooks.effects[0]();
  await vi.waitFor(() => expect(hooks.slots.get("root")).toContain("failed"));
  expect(nodes(render()).some(n => n.type === "button" && n.props.children === "저장 결과 다시 조회")).toBe(true);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/analysis"))).toBe(true);
});

it("keeps the mounted snapshot and Provider records during pending, failed and identical reanalysis and blocks duplicate requests", async () => {
  await prepareInitialAnalysis();
  fetcher.mockResolvedValueOnce(Response.json(initial)); await analyze(render()); let tree = render();
  const beforePanel = panels(tree)[0], beforeAnalysis = findings(tree)[0].props.analysis;
  const store = provider(String(beforePanel.key)).props.value;
  store.update("finding:SQL_INJECTION:sqli:1", {}, (previous: SecurityRecordDraft) => ({ ...previous, memo: "retained manual note" }));
  await checkLatest();
  let reject!: (error: Error) => void;
  fetcher.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const staleTree = render(); const pending = analyze(staleTree); await analyze(staleTree);
  expect(analysisCalls()).toHaveLength(2);
  tree = render(); expect(panels(tree)[0].key).toBe(beforePanel.key);
  expect(findings(tree)[0].props.analysis).toBe(beforeAnalysis);
  expect(nodes(tree).find(n => n.type === "fieldset")!.props.disabled).toBe(true);
  expect(provider(String(beforePanel.key)).props.value.drafts["finding:SQL_INJECTION:sqli:1"].memo).toBe("retained manual note");
  reject(new Error("fixture analysis failure")); await pending; tree = render();
  expect(panels(tree)).toHaveLength(1); expect(panels(tree)[0].key).toBe(beforePanel.key);
  expect(findings(tree)[0].props.analysis).toBe(beforeAnalysis);
  expect(nodes(tree).find(n => n.type === "fieldset")!.props.disabled).toBe(false);
  fetcher.mockResolvedValueOnce(Response.json({ ...initial, collection: { ...initial.collection, durationMs: 999, cached: true } }));
  await analyze(tree); tree = render();
  expect(panels(tree)).toHaveLength(1); expect(panels(tree)[0].key).toBe(beforePanel.key);
  expect(findings(tree)[0].props.analysis).toBe(beforeAnalysis);
  expect(provider(String(beforePanel.key)).props.value.drafts["finding:SQL_INJECTION:sqli:1"].memo).toBe("retained manual note");
  expect(hooks.refresh).toHaveBeenCalledTimes(2);
});

it("isolates changed commits and same-SHA candidate/schema changes while retaining earlier read-only records", async () => {
  await prepareInitialAnalysis();
  const original = retainServiceAnalysis([], initial);
  const finding = initial.sqlInjection!.findings[0];
  const variants: RepositoryAnalysis[] = [
    { ...initial, collection: { ...initial.collection!, commitSha: "b".repeat(40) } },
    ...[{ ...finding, id: "sqli:other" }, { ...finding, line: 2 }, { ...finding, code: "different source" }, { ...finding, sink: "db.execute" }]
      .map(candidate => ({ ...initial, sqlInjection: { ...initial.sqlInjection!, findings: [candidate] } })),
    { ...initial, sqlInjection: undefined },
    { ...initial, entryPoints: [{ kind: "api", framework: "next-app", filePath: "route.ts", routePath: "/api/changed", method: "GET", nodeId: "handler" }] },
    { ...initial, files: [{ path: "route.ts", name: "route.ts", sourceCode: "changed", imports: [], functions: [] }] },
  ];
  for (const next of variants) {
    const updated = retainServiceAnalysis(original, next);
    expect(updated).toHaveLength(2); expect(updated[0]).toBe(original[0]);
    expect(updated[1].id).not.toBe(updated[0].id); expect(updated[1].identity).not.toBe(updated[0].identity);
  }
  expect(serviceAnalysisIdentity({ ...initial, stats: { relations: 0, functions: 0, files: 0 } })).toBe(serviceAnalysisIdentity(initial));
  expect(serviceAnalysisIdentity({ ...initial, analyzedAt: "2026-11-24T00:00:00Z" })).toBe(serviceAnalysisIdentity({ ...initial, analyzedAt: "2026-11-24T01:00:00Z" }));
  fetcher.mockResolvedValueOnce(Response.json(initial)); await analyze(render()); let tree = render();
  const oldKey = String(panels(tree)[0].key);
  provider(oldKey).props.value.update("finding:SQL_INJECTION:sqli:1", {}, (previous: SecurityRecordDraft) => ({ ...previous, memo: "old commit note" }));
  await checkLatest();
  fetcher.mockResolvedValueOnce(Response.json(variants[0])); await analyze(render()); tree = render();
  expect(panels(tree)).toHaveLength(2);
  expect(panels(tree)[1].key).toBe(oldKey);
  expect(findings(tree)[0].props.archived).toBe(false); expect(findings(tree)[1].props.archived).toBe(true);
  const fieldsets = nodes(tree).filter(n => n.type === "fieldset");
  // Both the new review workspace and retained static detail must honor snapshot read-only state.
  expect(fieldsets.map(field => field.props.disabled)).toEqual([false, false, true, true]);
  expect((findings(tree)[0].props.analysis as RepositoryAnalysis).collection?.commitSha).toBe("b".repeat(40));
  expect((findings(tree)[1].props.analysis as RepositoryAnalysis).collection?.commitSha).toBe("a".repeat(40));
  expect(provider(oldKey, true).props.value.drafts["finding:SQL_INJECTION:sqli:1"].memo).toBe("old commit note");
  expect(provider(String(panels(tree)[0].key)).props.value.drafts).toEqual({});
  // Returning to an archived SHA creates a fresh snapshot; it does not reactivate its old approval/results.
  await checkLatest();
  fetcher.mockResolvedValueOnce(Response.json(initial)); await analyze(render()); tree = render();
  expect(panels(tree)).toHaveLength(3); expect(String(panels(tree)[0].key)).not.toBe(oldKey);
});

it("shows saved results before commit lookup resolves, coalesces effect replay, and disables identical reanalysis", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ analysis: initial })); render(); hooks.effects[0]();
  await vi.waitFor(() => expect(findings(render())).toHaveLength(1));
  let resolve!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(); const effect = hooks.effects.at(-1)!;
  const cancel = effect(); cancel(); effect();
  expect(findings(render())).toHaveLength(1);
  expect(analysisButton().props.disabled).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/latest-commit"))).toHaveLength(1);
  resolve(Response.json({ repository: "org/app", sha: initial.collection!.commitSha, branch: "main" }));
  await vi.waitFor(() => expect(hooks.slots.get("root")).toContainEqual(expect.objectContaining({ sha: initial.collection!.commitSha })));
  expect(analysisButton().props.disabled).toBe(true);
  await analyze(render()); expect(analysisCalls()).toHaveLength(0);
});

it("preserves results on commit failure, retries only the SHA check, and enables changed-commit reanalysis", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ analysis: initial })); render(); hooks.effects[0]();
  await vi.waitFor(() => expect(findings(render())).toHaveLength(1));
  fetcher.mockResolvedValueOnce(Response.json({ message: "failed" }, { status: 503 }));
  render(); hooks.effects.at(-1)!();
  await vi.waitFor(() => expect(hooks.slots.get("root")).toContainEqual(expect.objectContaining({ failed: true })));
  expect(findings(render())).toHaveLength(1); expect(analysisButton().props.disabled).toBe(true);
  const retry = nodes(render()).find(n => n.type === "button" && n.props.children === "최신 상태 다시 확인")!;
  (retry.props.onClick as () => void)();
  await checkLatest("b".repeat(40));
  expect(analysisButton().props.disabled).toBe(false);
  expect(analysisCalls()).toHaveLength(0);
  fetcher.mockResolvedValueOnce(Response.json({ ...initial, collection: { ...initial.collection, commitSha: "b".repeat(40) } }));
  await analyze(render()); expect(findings(render())).toHaveLength(2);
  expect(findings(render())[1].props.archived).toBe(true);
  await checkLatest("b".repeat(40)); expect(analysisButton().props.disabled).toBe(true);
});
