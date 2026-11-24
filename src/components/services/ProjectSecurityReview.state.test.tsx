import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => unknown> }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }]; },
  useEffect: (effect: () => unknown, deps: unknown[]) => { const index = hooks.cursor++, previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((d, i) => !Object.is(d, previous[i]))) { hooks.slots[index] = deps; hooks.effects.push(effect); } },
}));
import { ProjectSecurityReview } from "./ProjectSecurityReview";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import { emptyProjectReview, reviewRecordDraft, reviewRecordKey } from "@/lib/security-lab/projectReview";
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : [];
}
const analysis: RepositoryAnalysis = { repository: "org/app", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 }, collection: { source: "github", commitSha: "a".repeat(40), discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, partial: false, durationMs: 0 } };
const environment: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 7, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://sandbox.example.org", ownershipStatus: "VERIFIED", verifiedAt: "2026-11-24T00:00:00Z", testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
function workspace() {
  hooks.cursor = 0;
  const root = ProjectSecurityReview({ analysis, connectionId: "own" });
  return nodes(root).find(node => typeof node.type === "function" && node.type.name === "ReviewWorkspace")!;
}
let component: Element;
function render() { hooks.cursor = 0; return (component.type as (props: unknown) => ReactNode)(component.props); }
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; vi.stubGlobal("fetch", vi.fn());
  workspace(); hooks.slots[0] = environment; component = workspace(); hooks.slots = []; hooks.effects = []; });
afterEach(() => vi.unstubAllGlobals());

it("restores only matching manual progress across paginated DB results and keeps guides accessible", async () => {
  const review = { ...emptyProjectReview(), completed: true, outcome: "NOT_APPLICABLE" as const, expected: "Review SQL use", observed: "No SQL in reviewed scope", notes: "Documented scope", evidence: "source review" };
  const record = { id: "saved", revision: 1, repositoryFullName: "org/app", commitSha: "a".repeat(40), kind: "SQL_INJECTION", recordKey: reviewRecordKey("own", 7, "SQL_INJECTION"), draft: reviewRecordDraft(review, environment) };
  const fetcher = vi.mocked(fetch);
  fetcher.mockResolvedValueOnce(Response.json({ records: [{ ...record, commitSha: "b".repeat(40) }, { ...record, recordKey: reviewRecordKey("other", 7, "SQL_INJECTION") }], nextCursor: "next" }))
    .mockResolvedValueOnce(Response.json({ records: [record], nextCursor: null }));
  let tree = render();
  expect(nodes(tree).find(node => node.type === "progress")?.props.value).toBe(0);
  hooks.effects.splice(0).forEach(effect => effect());
  await vi.waitFor(() => expect(hooks.slots[5]).toBe(false));
  tree = render();
  expect(nodes(tree).find(node => node.type === "progress")?.props.value).toBe(25);
  expect(nodes(tree).filter(node => typeof node.type === "function" && node.type.name === "ReviewGuide")).toHaveLength(4);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[1][0])).toContain("cursor=next");
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("/api/results?"))).toBe(true);
});

it("requires isolation confirmation and complete evidence before marking a manual review complete", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ records: [], nextCursor: null }));
  render(); hooks.effects.splice(0).forEach(effect => effect());
  await vi.waitFor(() => expect(hooks.slots[5]).toBe(false));
  const reviews = hooks.slots[1] as Record<string, ReturnType<typeof emptyProjectReview>>;
  reviews.SQL_INJECTION = { ...emptyProjectReview(), expected: "Bound values", observed: "Observed synthetic result", evidence: "test-1", outcome: "NOT_OBSERVED" };
  let tree = render();
  let complete = nodes(tree).find(node => node.type === "button" && node.props.children === "검토 완료 표시 (수동)")!;
  expect(complete.props.disabled).toBe(true);
  const checkbox = nodes(tree).find(node => node.type === "input" && node.props.type === "checkbox")!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  tree = render(); complete = nodes(tree).find(node => node.type === "button" && node.props.children === "검토 완료 표시 (수동)")!;
  expect(complete.props.disabled).toBe(false);
  (complete.props.onClick as () => void)();
  expect(nodes(render()).find(node => node.type === "progress")?.props.value).toBe(25);
  const textarea = nodes(render()).find(node => node.type === "textarea")!;
  (textarea.props.onChange as (event: unknown) => void)({ target: { value: "Updated expectation" } });
  expect(nodes(render()).find(node => node.type === "progress")?.props.value).toBe(0);
});
