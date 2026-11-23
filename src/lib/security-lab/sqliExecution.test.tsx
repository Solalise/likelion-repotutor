import { EventEmitter } from "node:events";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ManagedSqliTarget, SqliExecutionApproval } from "./sqliRegistry";
import type { SqliRequestDraft } from "./sqliTypes";

const mocks = vi.hoisted(() => ({ registry: { target: null as unknown, approvals: [] as unknown[] }, user: vi.fn(), access: vi.fn(),
  dns: vi.fn(), lookup: vi.fn(), request: vi.fn(), transaction: vi.fn(), findRun: vi.fn(), account: vi.fn(), cache: vi.fn(),
  vercel: vi.fn(), loadAccount: vi.fn(), project: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./sqliRegistry", () => ({ managedSqliRegistry: () => mocks.registry }));
vi.mock("node:dns/promises", () => ({ Resolver: class { resolve4 = mocks.dns; cancel() {} }, lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("@/lib/github/repositoryAccess", async original => ({ ...await original<typeof import("@/lib/github/repositoryAccess")>(), requireRepositoryAccess: mocks.access }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction, analysisRun: { findFirst: mocks.findRun }, account: { findFirst: mocks.account } } }));
vi.mock("@/lib/repository/githubAnalysisCache", () => ({ getGithubAnalysisCache: mocks.cache, githubAnalysisCacheKey: (...parts: string[]) => parts.join(":") }));
vi.mock("@/lib/vercel/deploymentCommit", async original => ({ ...await original<typeof import("@/lib/vercel/deploymentCommit")>(), loadVercelAccount: mocks.loadAccount,
  verifyVercelProject: mocks.project, vercelJson: mocks.vercel }));
import { safeSqliProbe } from "./sqliProbe";
import { safeXssProbe } from "./xssProbe";
import { selectSqliApproval } from "./sqliPolicy";
import { executeSqliPair, sqliExecutionStatus } from "./sqliExecution";
import { observeManagedSqli } from "./sqliTransport";
import { POST } from "@/app/api/repositories/[connectionId]/practice/sqli/route";
import { SqliRequestEditor } from "@/components/repository/SqliRequestEditor";

const target: ManagedSqliTarget = { id: "managed-one", origin: "https://fixture-only.vercel.app", path: "/api/search", method: "GET", parameter: "q",
  projectId: "prj_fixture", deploymentId: "dpl_fixture", isolatedTestOnly: true, syntheticDataOnly: true, readOnlyDatabase: true, sideEffectFreeApi: true, reviewReference: "test-fixture-not-a-live-deployment" };
const draft: SqliRequestDraft = { version: "sqli-practice-v1", connectionId: "connection-one", repository: "org/test", commitSha: "a".repeat(40), findingId: "sqli:route:1",
  target: { deploymentOrigin: target.origin, apiPath: target.path, method: "GET", inputLocation: "query", parameter: "q" }, baseline: { value: "normal" }, test: { value: safeSqliProbe.value } };
const approval = (): SqliExecutionApproval => ({ id: "approval-one", targetId: target.id, userId: "user-a", connectionId: "connection-one", analysisRunId: "analysis-one",
  repository: draft.repository, commitSha: draft.commitSha!, findingId: draft.findingId, deploymentVersion: 7,
  issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), maxRequests: 2 });

function serve(status = 200, text = '{"observed":"fixture response"}', headers: Record<string, string> = {}, ip = "93.184.216.34") {
  mocks.request.mockImplementation(() => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    req.destroy = vi.fn();
    req.end = () => queueMicrotask(() => {
      const socket = new EventEmitter(); Object.assign(socket, { remoteAddress: ip }); req.emit("socket", socket); socket.emit("connect");
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void };
      Object.assign(response, { statusCode: status, headers, destroy: vi.fn() }); req.emit("response", response);
      response.emit("data", Buffer.from(text)); response.emit("end");
    });
    return req;
  });
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.registry.target = null; mocks.registry.approvals = []; });

it("rejects unauthenticated, cross-origin, unconfirmed, malformed and custom-probe API calls before target transport", async () => {
  const make = (payload: unknown, origin = "https://vulnlab.example") => new Request("https://vulnlab.example/api/repositories/connection-one/practice/sqli", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const context = { params: Promise.resolve({ connectionId: "connection-one" }) };
  mocks.user.mockRejectedValueOnce(new Error("AUTH_REQUIRED")); expect((await POST(make({ action: "execute", draft }), context)).status).toBe(401);
  mocks.user.mockResolvedValue("user-a");
  expect((await POST(make({ action: "status", draft }, "https://other.example"), context)).status).toBe(403);
  expect((await POST(make({ action: "execute", draft }), context)).status).toBe(400);
  expect((await POST(make({ action: "unknown", draft }), context)).status).toBe(400);
  expect((await POST(make({ action: "execute", confirmed: true, draft: { ...draft, test: { value: "custom-probe" } } }), context)).status).toBe(400);
  expect((await POST(make({ action: "status", draft: { ...draft, connectionId: "other" } }), context)).status).toBe(403);
  expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.dns).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
});

it("blocks an empty registry and tampering, validates the managed preview grant, and durably reserves only an approved pair", async () => {
  mocks.user.mockResolvedValue("user-a");
  const request = () => new Request("https://vulnlab.example/api/repositories/connection-one/practice/sqli", { method: "POST",
    headers: { Origin: "https://vulnlab.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", draft }) });
  const response = await POST(request(), { params: Promise.resolve({ connectionId: "connection-one" }) });
  expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ allowed: false, reason: expect.stringContaining("테스트 전용 배포가 없습니다") });
  expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.dns).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  const markup = renderToStaticMarkup(<SqliRequestEditor initialDraft={draft} onBack={() => {}} />);
  expect(markup).toMatch(/<button[^>]*disabled[^>]*>테스트 실행 환경 연결 전/);
  mocks.registry.target = target; mocks.registry.approvals = [approval()];
  expect(() => selectSqliApproval("other-user", draft)).toThrow("실행 승인");
  for (const changes of [{ deploymentOrigin: "https://outside.vercel.app" }, { apiPath: "/api/other" }, { parameter: "other" }]) {
    expect(() => selectSqliApproval("user-a", { ...draft, target: { ...draft.target, ...changes } })).toThrow("일치하지");
  }
  mocks.registry.approvals = [{ ...approval(), expiresAt: new Date(Date.now() - 1).toISOString() }];
  expect(() => selectSqliApproval("user-a", draft)).toThrow("만료"); mocks.registry.approvals = [approval()];
  const connection = { id: "connection-one", repositoryId: "repository-one", installation: { installationId: "7" }, repository: { fullName: draft.repository, githubRepositoryId: "42" },
    vercelUrl: target.origin, deploymentVersion: 7, deploymentOwnershipStatus: "VERIFIED", deploymentVerifiedAt: new Date(), vercelAccountId: "account-one", vercelProjectId: target.projectId, vercelTeamId: null };
  mocks.access.mockResolvedValue(connection); mocks.findRun.mockResolvedValue({ id: "analysis-one" });
  mocks.cache.mockReturnValue({ repository: draft.repository, collection: { commitSha: draft.commitSha }, sqlInjection: { findings: [{ id: draft.findingId }] } });
  mocks.loadAccount.mockResolvedValue({ account: { id: "account-one" }, encryptedToken: "encrypted-fixture", token: "MUST_NOT_FORWARD", signal: new AbortController().signal });
  mocks.account.mockResolvedValue({ access_token: "encrypted-fixture", expires_at: null }); mocks.project.mockResolvedValue({});
  const proof = { id: target.deploymentId, projectId: target.projectId, url: "fixture-only.vercel.app", target: null, readyState: "READY", source: "git", gitSource: { type: "github", repoId: 42, sha: draft.commitSha } };
  mocks.vercel.mockResolvedValue({ ...proof, target: "production" });
  await expect(sqliExecutionStatus("user-a", draft)).rejects.toThrow("비운영"); expect(mocks.request).not.toHaveBeenCalled();
  mocks.vercel.mockResolvedValue(proof);
  let stats: Record<string, unknown> = { files: 1 };
  let queue = Promise.resolve();
  const tx = { $queryRaw: async (parts: TemplateStringsArray) => parts.join("").includes("FOR UPDATE") ? [{ id: "user-a" }] : [{ now: new Date() }],
    analysisRun: { findFirst: async () => ({ stats }), findMany: async () => stats.sqliExecution ? [{ stats }] : [],
      update: async ({ data }: { data: { stats: Record<string, unknown> } }) => { stats = data.stats; return {}; } } };
  mocks.transaction.mockImplementation((work: (value: typeof tx) => Promise<unknown>) => { const p = queue.then(() => work(tx)); queue = p.then(() => undefined, () => undefined); return p; });
  expect(await sqliExecutionStatus("user-a", draft)).toMatchObject({ allowed: true, remainingRequests: 2 });
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.dns.mockResolvedValue(["93.184.216.34"]); serve();
  const result = await executeSqliPair("user-a", draft);
  expect(result.assessment?.status).toBe("INCONCLUSIVE"); expect(result.baseline?.statusCode).toBe(200); expect(result.test?.statusCode).toBe(200);
  expect(mocks.request).toHaveBeenCalledTimes(2);
  const options = mocks.request.mock.calls[1][0];
  expect(options).toMatchObject({ hostname: "93.184.216.34", servername: "fixture-only.vercel.app", rejectUnauthorized: true, method: "GET", agent: false });
  expect(options.headers).not.toHaveProperty("Cookie"); expect(options.headers).not.toHaveProperty("Authorization");
  expect(new URL(options.path, target.origin).searchParams.getAll("q")).toEqual([draft.test.value]);
  await expect(executeSqliPair("user-a", draft)).rejects.toMatchObject({ status: 429 }); expect(mocks.request).toHaveBeenCalledTimes(2);
  mocks.transaction.mockRejectedValueOnce(new Error("DB unavailable")); await expect(sqliExecutionStatus("user-a", draft)).rejects.toThrow("DB unavailable");
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

it("pins checked IPv4 and blocks private DNS, rebinding, redirects, oversized bodies, TLS/network failure and timeouts", async () => {
  const check = vi.fn(); mocks.request.mockClear();
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "168.63.129.16", "::ffff:127.0.0.1"]) {
    mocks.dns.mockResolvedValue(["93.184.216.34", ip]);
    expect((await observeManagedSqli(target, "x", check)).outcome).toBe("BLOCKED");
  }
  expect(mocks.request).not.toHaveBeenCalled(); mocks.dns.mockResolvedValue(["93.184.216.34"]);
  serve(302, "", { location: "http://127.0.0.1/" });
  expect((await observeManagedSqli(target, "x", check)).outcome).toBe("BLOCKED"); expect(mocks.request).toHaveBeenCalledTimes(1);
  serve(200, "", { "content-length": "20000" });
  expect(await observeManagedSqli(target, "x", check)).toMatchObject({ outcome: "SIZE_LIMIT", bodyTruncated: true });
  serve(200, "x".repeat(17000)); expect((await observeManagedSqli(target, "x", check)).outcome).toBe("SIZE_LIMIT");
  serve(200, "", {}, "127.0.0.1"); expect((await observeManagedSqli(target, "x", check)).outcome).toBe("BLOCKED");
  serve(403, "denied"); expect((await observeManagedSqli(target, "x", check)).outcome).toBe("ACCESS_DENIED");
  serve(200, "<script>fixture</script>"); const observed = await observeManagedSqli(target, "x", check);
  expect(observed.body).toBe("<script>fixture</script>");
  const tlsCheck = mocks.request.mock.calls.at(-1)![0].checkServerIdentity;
  expect(tlsCheck("ignored-ip", {})).toBeInstanceOf(Error);
  serve(200, safeXssProbe.value, { "content-type": "text/html; charset=utf-8" });
  expect(await observeManagedSqli(target, safeXssProbe.value, check, Date.now() + 60000, "XSS")).toMatchObject({ outcome: "RESPONSE", contentType: "text/html; charset=utf-8", body: safeXssProbe.value });
  expect(mocks.request.mock.calls.at(-1)![0]).toMatchObject({ rejectUnauthorized: true, headers: { Accept: "text/html, application/xhtml+xml, text/plain, application/json", "User-Agent": "VulnLab-Managed-XSS/1.0" } });
  mocks.request.mockImplementation(() => { const req = new EventEmitter(); Object.assign(req, { destroy: vi.fn(), end: () => queueMicrotask(() => req.emit("error", new Error("TLS fixture"))) }); return req; });
  expect((await observeManagedSqli(target, "x", check)).outcome).toBe("NETWORK_ERROR");
  vi.useFakeTimers();
  mocks.request.mockImplementation(() => Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() }));
  const pending = observeManagedSqli(target, "x", check); await vi.advanceTimersByTimeAsync(8001);
  expect((await pending).outcome).toBe("TIMEOUT"); vi.useRealTimers();
  const count = mocks.request.mock.calls.length;
  const expired = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error("expired"); });
  expect((await observeManagedSqli(target, "x", expired)).outcome).toBe("BLOCKED"); expect(mocks.request).toHaveBeenCalledTimes(count);
});
