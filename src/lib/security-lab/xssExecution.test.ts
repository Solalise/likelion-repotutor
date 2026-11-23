import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedXssTarget } from "./xssRegistry";
import type { SqliExecutionApproval } from "./sqliRegistry";
import type { XssRequestDraft } from "./xssTypes";
const m = vi.hoisted(() => ({ registry: { target: null as ManagedXssTarget | null, approvals: [] as SqliExecutionApproval[] }, user: vi.fn(), access: vi.fn(), analysis: vi.fn(), account: vi.fn(), cache: vi.fn(), loadAccount: vi.fn(), project: vi.fn(), vercel: vi.fn(), transaction: vi.fn(), observe: vi.fn() }));
vi.mock("./xssRegistry", () => ({ managedXssRegistry: () => m.registry }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: m.user }));
vi.mock("@/lib/github/repositoryAccess", async original => ({ ...await original<typeof import("@/lib/github/repositoryAccess")>(), requireRepositoryAccess: m.access }));
vi.mock("@/lib/db", () => ({ db: { analysisRun: { findFirst: m.analysis }, account: { findFirst: m.account }, $transaction: m.transaction } }));
vi.mock("@/lib/repository/githubAnalysisCache", () => ({ getGithubAnalysisCache: m.cache, githubAnalysisCacheKey: (...args: string[]) => args.join(":") }));
vi.mock("@/lib/vercel/deploymentCommit", async original => ({ ...await original<typeof import("@/lib/vercel/deploymentCommit")>(), loadVercelAccount: m.loadAccount, verifyVercelProject: m.project, vercelJson: m.vercel }));
vi.mock("./sqliTransport", () => ({ observeManagedSqli: m.observe }));
import { safeXssProbe } from "./xssProbe";
import { parseXssDraft, selectXssApproval } from "./xssPolicy";
import { xssExecutionStatus, executeXssPair } from "./xssExecution";
import { POST } from "@/app/api/repositories/[connectionId]/practice/xss/route";
const target: ManagedXssTarget = { id: "xss-target", origin: "https://fixture-only.vercel.app", path: "/api/search", method: "GET", parameter: "q", projectId: "prj_fixture", deploymentId: "dpl_fixture", isolatedTestOnly: true, syntheticDataOnly: true, readOnlyDatabase: true, sideEffectFreeApi: true, reviewReference: "fixture-no-live-target", reflectionLocation: "result text", reflectionContext: "HTML_TEXT" };
const draft: XssRequestDraft = { version: "xss-practice-v1", connectionId: "connection", repository: "org/repo", commitSha: "a".repeat(40), findingId: "xss:route:1", target: { deploymentOrigin: target.origin, apiPath: target.path, method: "GET", inputLocation: "query", parameter: "q", reflectionLocation: target.reflectionLocation, reflectionContext: target.reflectionContext }, baseline: { value: safeXssProbe.baseline }, test: { value: safeXssProbe.value } };
const approval = (): SqliExecutionApproval => ({ id: "xss-approval", targetId: target.id, userId: "user", connectionId: "connection", analysisRunId: "analysis", repository: draft.repository, commitSha: draft.commitSha!, findingId: draft.findingId, deploymentVersion: 1, issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), maxRequests: 6 });
beforeEach(() => { vi.resetAllMocks(); m.registry.target = null; m.registry.approvals = []; m.user.mockResolvedValue("user"); });
function setup(prior = 0) {
  m.registry.target = target; m.registry.approvals = [approval()];
  m.access.mockResolvedValue({ repositoryId: "repo", repository: { fullName: draft.repository, githubRepositoryId: "42" }, installation: { installationId: "7" }, vercelUrl: target.origin, deploymentVersion: 1, deploymentOwnershipStatus: "VERIFIED", deploymentVerifiedAt: new Date(), vercelAccountId: "account", vercelProjectId: target.projectId, vercelTeamId: null });
  m.analysis.mockResolvedValue({ id: "analysis" }); m.cache.mockReturnValue({ repository: draft.repository, collection: { commitSha: draft.commitSha }, xss: { findings: [{ id: draft.findingId, disposition: "candidate" }] } });
  m.loadAccount.mockResolvedValue({ account: { id: "account" }, token: "fixture-only", encryptedToken: "encrypted-fixture", signal: new AbortController().signal }); m.account.mockResolvedValue({ access_token: "encrypted-fixture", expires_at: null }); m.project.mockResolvedValue({});
  m.vercel.mockResolvedValue({ id: target.deploymentId, projectId: target.projectId, url: "fixture-only.vercel.app", target: null, readyState: "READY", source: "git", gitSource: { type: "github", repoId: "42", sha: draft.commitSha } });
  let stats: Record<string, unknown> = { files: 1, ...(prior ? { sqliExecution: { usedRequests: prior, lastReservedAt: Date.now() } } : {}) };
  const tx = { $queryRaw: async (parts: TemplateStringsArray) => parts.join("").includes("FOR UPDATE") ? [{ id: "user" }] : [{ now: new Date() }], analysisRun: { findFirst: async () => ({ stats }), findMany: async () => [{ stats }], update: async ({ data }: { data: { stats: Record<string, unknown> } }) => { stats = data.stats; } } };
  let queue = Promise.resolve(); m.transaction.mockImplementation((work: (value: typeof tx) => Promise<unknown>) => { const next = queue.then(() => work(tx)); queue = next.then(() => undefined, () => undefined); return next; });
  m.observe.mockResolvedValue({ requestId: "response", observedAt: new Date().toISOString(), outcome: "RESPONSE", statusCode: 200, durationMs: 1, body: "<p>fixture</p>", contentType: "text/html", bodyTruncated: false, errorMessage: null });
  return () => stats;
}
function request(payload: unknown, origin = "https://vulnlab.test") { return new Request("https://vulnlab.test/api/repositories/connection/practice/xss", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
const context = { params: Promise.resolve({ connectionId: "connection" }) };
describe("managed XSS approval and shared budget", () => {
  it("blocks empty registry, missing authentication, cross-origin and altered markers before transport", async () => {
    expect((await POST(request({ action: "status", draft }), context)).status).toBe(403);
    m.user.mockRejectedValueOnce(new Error("AUTH_REQUIRED")); expect((await POST(request({ action: "status", draft }), context)).status).toBe(401);
    expect((await POST(request({ action: "execute", confirmed: true, draft }, "https://other.test"), context)).status).toBe(403);
    for (const changes of [{ test: { value: "custom" } }, { baseline: { value: "custom" } }, { version: "sqli-practice-v1" }, { target: { ...draft.target, reflectionLocation: "" } }]) expect((await POST(request({ action: "execute", confirmed: true, draft: { ...draft, ...changes } }), context)).status).toBe(400);
    expect(m.observe).not.toHaveBeenCalled(); expect(m.access).not.toHaveBeenCalled();
  });
  it("binds the grant to the user, candidate and reflection location and never treats ownership as permission", async () => {
    setup(); expect(parseXssDraft(draft)).toEqual(draft);
    expect(() => selectXssApproval("other", draft)).toThrow("실행 승인");
    expect(() => selectXssApproval("user", { ...draft, target: { ...draft.target, reflectionLocation: "other" } })).toThrow("반영 위치");
    m.registry.approvals = [{ ...approval(), expiresAt: new Date(Date.now() - 1).toISOString() }]; expect(() => selectXssApproval("user", draft)).toThrow("만료");
    setup(); m.cache.mockReturnValue({ repository: draft.repository, collection: { commitSha: draft.commitSha }, xss: { findings: [{ id: draft.findingId, disposition: "protected" }] } });
    await expect(xssExecutionStatus("user", draft)).rejects.toThrow("검사 후보"); expect(m.observe).not.toHaveBeenCalled();
  });
  it("executes exactly a fixed pair and shares the hourly six-request limit with SQLi", async () => {
    const stats = setup(4); expect(await xssExecutionStatus("user", draft)).toMatchObject({ allowed: true, remainingRequests: 2 }); expect(m.observe).not.toHaveBeenCalled();
    const r = await executeXssPair("user", draft); expect(r.request).toEqual(draft); expect(r.assessment?.status).toBe("INCONCLUSIVE");
    expect(m.observe).toHaveBeenCalledTimes(2); expect(m.observe.mock.calls.map(row => row[1])).toEqual([safeXssProbe.baseline, safeXssProbe.value]); expect(m.observe.mock.calls[0][4]).toBe("XSS");
    expect(stats()).toMatchObject({ files: 1, sqliExecution: { usedRequests: 4 }, xssExecution: { usedRequests: 2 } });
    await expect(executeXssPair("user", draft)).rejects.toMatchObject({ status: 429 }); expect(m.observe).toHaveBeenCalledTimes(2);
  });
  it("does not send the second request after baseline failure or revoked permission", async () => {
    setup(); m.observe.mockResolvedValueOnce({ outcome: "TIMEOUT" }); expect((await executeXssPair("user", draft)).test?.outcome).toBe("BLOCKED"); expect(m.observe).toHaveBeenCalledTimes(1);
    setup(); m.observe.mockClear(); m.observe.mockImplementationOnce(async () => { m.registry.approvals = []; return { outcome: "RESPONSE" }; });
    expect((await executeXssPair("user", draft)).test?.outcome).toBe("BLOCKED"); expect(m.observe).toHaveBeenCalledTimes(1);
  });
  it("reserves the last pair atomically under concurrent calls and fails closed on DB or production checks", async () => {
    setup(4); const runs = await Promise.allSettled([executeXssPair("user", draft), executeXssPair("user", draft)]); expect(runs.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(m.observe).toHaveBeenCalledTimes(2);
    setup(); m.observe.mockClear(); m.transaction.mockRejectedValueOnce(new Error("DB unavailable")); await expect(executeXssPair("user", draft)).rejects.toThrow("DB unavailable"); expect(m.observe).not.toHaveBeenCalled();
    setup(); m.vercel.mockResolvedValue({ target: "production" }); await expect(executeXssPair("user", draft)).rejects.toThrow("비운영"); expect(m.observe).not.toHaveBeenCalled();
  });
});
