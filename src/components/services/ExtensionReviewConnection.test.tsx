import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = initial; return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }]; },
  useRef: (initial: unknown) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; }, useEffect: () => {},
}));
import { ExtensionReviewConnection } from "./ExtensionReviewConnection";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
const analysis: RepositoryAnalysis = { repository: "org/app", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 }, collection: { source: "github", commitSha: "a".repeat(40), discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, partial: false, durationMs: 0 } };
const environment: DeploymentConnectionSnapshot = { connectionId: "own", deploymentVersion: 7, repository: { fullName: "org/app", htmlUrl: "https://github.com/org/app" }, deployment: { vercelUrl: "https://sandbox.example.org", ownershipStatus: "UNVERIFIED", verifiedAt: null, testRequestsAllowed: false, challengeExpiresAt: null, verificationAttemptsRemaining: 5 } };
type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(nodes); return isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []; }
function render(env = environment) { hooks.cursor = 0; return nodes(ExtensionReviewConnection({ analysis, connectionId: "own", environment: env })); }
let listener: (data: Record<string, unknown>) => Promise<void>;
const port = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, onDisconnect: { addListener: vi.fn() } };
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; vi.clearAllMocks(); vi.stubGlobal("chrome", { runtime: { connect: vi.fn(() => port) } }); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(environment))); });
afterEach(() => vi.unstubAllGlobals());
async function connect() {
  const tree = render(); const inputs = tree.filter(n => n.type === "input");
  (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "a".repeat(32) } });
  const button = render().find(n => n.type === "button")!; (button.props.onClick as () => void)();
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
  return port.postMessage.mock.calls[0][0].session;
}
it("allows educational connection without ownership or isolated confirmation and never opens a site on connect", async () => {
  expect(render().find(n => n.type === "button")!.props.disabled).toBe(false);
  const session = await connect(); expect(session.project).toBe("org/app"); expect(session.guides).toHaveLength(4);
  expect(fetch).toHaveBeenCalledTimes(2); expect(port.postMessage.mock.calls.map(([m]) => m.type)).toEqual(["SESSION"]);
  expect(render({ ...environment, deployment: { ...environment.deployment, vercelUrl: null } }).find(n => n.type === "button")!.props.disabled).toBe(false);
});
it("rechecks scope and stores only a validated manual observation through same-origin authenticated APIs", async () => {
  const session = await connect();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(environment)).mockImplementationOnce(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); return Response.json({ ...body, id: "saved", revision: 1 });
  });
  await listener({ type: "SAVE", sessionId: session.id, kind: "XSS", review: { completed: true, outcome: "NOT_OBSERVED", expected: "Text output", observed: "Displayed as text", notes: "", evidence: "Synthetic test", codeLocation: "src/view.tsx:9" } });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(vi.mocked(fetch).mock.calls[3][0]).toBe("/api/results");
  expect(vi.mocked(fetch).mock.calls[3][1]?.credentials).toBe("same-origin");
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body)).commitSha).toBe(session.commit);
  expect(JSON.parse(JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body)).draft.memo)).toMatchObject({ completed: false, recordMode: "manual-observation", executionApproved: false });
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: "SAVED", sessionId: session.id, kind: "XSS", id: "saved" });
});
it("rejects stale environments and mismatched session messages without saving or opening", async () => {
  const session = await connect(); const calls = vi.mocked(fetch).mock.calls.length;
  await listener({ type: "OPEN_SITE", sessionId: "other" }); expect(fetch).toHaveBeenCalledTimes(calls);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...environment, deploymentVersion: 8 }));
  await listener({ type: "OPEN_SITE", sessionId: session.id });
  expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ERROR" }));
  expect(port.postMessage.mock.calls.some(([m]) => m.type === "OPEN_CONFIRMED")).toBe(false);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/api/results"))).toBe(false);
});
it("does not replace denied repository access with a fallback connection", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(environment)).mockResolvedValueOnce(Response.json({ message: "denied" }, { status: 403 }));
  const input = render().find(n => n.type === "input")!;
  (input.props.onChange as (e: unknown) => void)({ target: { value: "a".repeat(32) } });
  (render().find(n => n.type === "button")!.props.onClick as () => void)();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(port.postMessage).not.toHaveBeenCalled();
});
