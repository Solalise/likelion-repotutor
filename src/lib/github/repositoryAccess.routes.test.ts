import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), connection: vi.fn(), revoke: vi.fn(), token: vi.fn(), json: vi.fn(),
  installationToken: vi.fn(), load: vi.fn(), analyze: vi.fn(), cache: vi.fn(), storeCache: vi.fn(),
  createRun: vi.fn(), updateRun: vi.fn(), latestRun: vi.fn(), learningRecord: vi.fn(), saveLearning: vi.fn(),
  context: vi.fn(), generate: vi.fn(), validate: vi.fn(), rate: vi.fn(),
}));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: {
  userRepository: { findFirst: mocks.connection, updateMany: mocks.revoke, update: vi.fn() },
  analysisRun: { create: mocks.createRun, update: mocks.updateRun, findFirst: mocks.latestRun },
  learningRecord: { findUnique: mocks.learningRecord, upsert: mocks.saveLearning },
  $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
} }));
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(), getGitHubUserAccessToken: mocks.token, githubJson: mocks.json,
}));
vi.mock("./appAuthentication", () => ({ getInstallationAccessToken: mocks.installationToken, createInstallationFetcher: vi.fn() }));
vi.mock("@/lib/repository/loadGithubRepository", () => ({ loadGithubRepository: mocks.load }));
vi.mock("@/lib/ast/analyzer", () => ({ analyzeSourceFiles: mocks.analyze }));
vi.mock("@/lib/repository/githubAnalysisCache", () => ({
  getGithubAnalysisCache: mocks.cache, setGithubAnalysisCache: mocks.storeCache,
  githubAnalysisCacheKey: (namespace: string, name: string, sha: string) => `${namespace}:${name}@${sha}`,
}));
vi.mock("@/lib/ai/learningContext", () => ({ buildLearningContext: mocks.context }));
vi.mock("@/lib/ai/learningExplanation", () => ({
  learningCacheKey: () => "learning-cache", LEARNING_PROMPT_VERSION: "test", validateLearningExplanation: mocks.validate,
}));
vi.mock("@/lib/ai/groq", () => ({
  GroqApiError: class extends Error {}, generateLearningExplanation: mocks.generate, groqModel: () => "test-model",
}));
vi.mock("@/lib/ai/learningRateLimit", () => ({ consumeLearningRequest: mocks.rate }));

import { GitHubApiError } from "./api";
import { GET } from "@/app/api/repositories/[connectionId]/analyze/route";
import { POST } from "@/app/api/repositories/[connectionId]/learn/route";

const connection = {
  id: "own-connection", userId: "user-a", repositoryId: "repo-1", active: true,
  installation: { id: "installation-row", userId: "user-a", installationId: "7", suspendedAt: null },
  repository: { id: "repo-1", githubRepositoryId: "21", fullName: "org/private", htmlUrl: "https://github.com/org/private" },
};
const installation = { id: 7, suspended_at: null, permissions: { contents: "read" } };
const repository = { id: 21, full_name: "org/private", permissions: { pull: true } };
const analysis = { repository: "org/private", nodes: [], edges: [], entryPoints: [], stats: {}, collection: { commitSha: "sha" } };
function params(id = "own-connection") { return { params: Promise.resolve({ connectionId: id }) }; }
function request() { return new Request("http://localhost/api/repositories/own-connection/learn", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection: { type: "function", id: "fn" } }),
}); }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue("user-a");
  mocks.connection.mockImplementation(async ({ where }) => where.id === connection.id && where.userId === connection.userId && where.active ? connection : null);
  mocks.token.mockResolvedValue("user-a-token");
  mocks.json.mockImplementation(async (path) => path.endsWith("/contents") ? [] : path.startsWith("/user/installations?")
    ? { total_count: 1, installations: [installation] } : { total_count: 1, repositories: [repository] });
  mocks.cache.mockReturnValue(analysis);
  mocks.load.mockResolvedValue({ repository: "org/private", sources: [], collection: { commitSha: "sha" } });
  mocks.analyze.mockReturnValue(analysis);
  mocks.installationToken.mockResolvedValue("app-token");
  mocks.createRun.mockResolvedValue({ id: "run" });
  mocks.latestRun.mockResolvedValue({ commitSha: "sha" });
  mocks.context.mockReturnValue({ code: [{ source: "protected source" }], selection: { name: "fn" } });
  mocks.learningRecord.mockResolvedValue({ result: "protected explanation", model: "test", updatedAt: new Date() });
  mocks.validate.mockReturnValue("protected explanation");
  mocks.rate.mockReturnValue({ allowed: true });
  mocks.generate.mockResolvedValue({ explanation: "generated explanation", model: "test", usage: {} });
  mocks.saveLearning.mockResolvedValue({ updatedAt: new Date() });
});

for (const [name, invoke] of [
  ["analysis", (id?: string) => GET(new Request("http://localhost/analyze"), params(id))],
  ["AI learning", (id?: string) => POST(request(), params(id))],
] as const) {
  describe(`${name} authorization before protected work and caches`, () => {
    it("rejects unauthenticated requests", async () => {
      mocks.user.mockRejectedValue(new Error("AUTH_REQUIRED"));
      expect((await invoke()).status).toBe(401);
      expect(mocks.connection).not.toHaveBeenCalled();
    });

    it("rejects another user's connection ID without contacting GitHub or caches", async () => {
      const response = await invoke("other-user-connection");
      expect(response.status).toBe(404);
      expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "other-user-connection", userId: "user-a", active: true } }));
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.learningRecord).not.toHaveBeenCalled();
      expect(mocks.installationToken).not.toHaveBeenCalled();
    });

    it("denies user B using user A's real, active connection ID", async () => {
      mocks.user.mockResolvedValue("user-b");
      expect((await invoke("own-connection")).status).toBe(404);
      expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "own-connection", userId: "user-b", active: true } }));
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.learningRecord).not.toHaveBeenCalled();
    });

    it.each([
      ["removed installation", { total_count: 0, installations: [] }, null],
      ["suspended installation", { total_count: 1, installations: [{ ...installation, suspended_at: "2026-11-09" }] }, null],
      ["contents permission removed", { total_count: 1, installations: [{ ...installation, permissions: {} }] }, null],
      ["organization/repository membership removed", null, { total_count: 0, repositories: [] }],
      ["read permission removed", null, { total_count: 1, repositories: [{ ...repository, permissions: { pull: false } }] }],
      ["unverifiable read permission", null, { total_count: 1, repositories: [{ id: 21, full_name: "org/private" }] }],
    ])("blocks %s even with warm analysis and AI caches", async (_reason, installations, repositories) => {
      mocks.json.mockImplementation(async (path) => path.startsWith("/user/installations?")
        ? installations ?? { total_count: 1, installations: [installation] }
        : repositories ?? { total_count: 1, repositories: [repository] });
      const response = await invoke();
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.revoke).toHaveBeenCalledWith({ where: { id: "own-connection", userId: "user-a" }, data: { active: false } });
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.learningRecord).not.toHaveBeenCalled();
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.generate).not.toHaveBeenCalled();
    });

    it.each([new Error("network timeout"), new GitHubApiError("rate limit", 429), new GitHubApiError("forbidden or rate limited", 403), new GitHubApiError("unavailable", 502)])("fails closed on an unverifiable GitHub response without durable revocation", async (error) => {
      mocks.json.mockRejectedValue(error);
      expect((await invoke()).status).toBe(503);
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.learningRecord).not.toHaveBeenCalled();
    });

    it("requires login again when the GitHub user grant expires/revokes", async () => {
      mocks.token.mockRejectedValue(new GitHubApiError("expired", 401));
      expect((await invoke()).status).toBe(401);
      expect(mocks.cache).not.toHaveBeenCalled();
    });

    it("rejects incomplete permission lists rather than trusting an earlier active connection", async () => {
      mocks.json.mockResolvedValue({ total_count: 2, installations: [installation] });
      expect((await invoke()).status).toBe(503);
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.cache).not.toHaveBeenCalled();
    });

    it.each([403, 404, 429])("blocks a user-token Contents denial (%s) even when installation metadata grants access", async (status) => {
      mocks.json.mockImplementation(async (path) => {
        if (path.endsWith("/contents")) throw new GitHubApiError("contents unavailable", status);
        return path.startsWith("/user/installations?")
          ? { total_count: 1, installations: [installation] } : { total_count: 1, repositories: [repository] };
      });
      expect((await invoke()).status).toBe(503);
      expect(mocks.json).toHaveBeenCalledWith("/repos/org/private/contents", "user-a-token", expect.anything());
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.learningRecord).not.toHaveBeenCalled();
      expect(mocks.installationToken).not.toHaveBeenCalled();
    });

    it("fails closed on a malformed successful Contents response", async () => {
      mocks.json.mockImplementation(async (path) => path.startsWith("/user/installations?")
        ? { total_count: 1, installations: [installation] } : { total_count: 1, repositories: [repository] });
      expect((await invoke()).status).toBe(503);
      expect(mocks.cache).not.toHaveBeenCalled();
    });

    it("rejects inactive connections and mismatched installation owners", async () => {
      mocks.connection.mockResolvedValueOnce(null);
      expect((await invoke()).status).toBe(404);
      mocks.connection.mockResolvedValueOnce({ ...connection, installation: { ...connection.installation, userId: "user-b" } });
      expect((await invoke()).status).toBe(404);
      expect(mocks.token).not.toHaveBeenCalled();
    });

    it("rejects a renamed/replaced repository instead of trusting an old URL", async () => {
      mocks.json.mockResolvedValueOnce({ total_count: 1, installations: [installation] })
        .mockResolvedValueOnce({ total_count: 1, repositories: [{ ...repository, full_name: "org/renamed" }] });
      expect((await invoke()).status).toBe(409);
      expect(mocks.cache).not.toHaveBeenCalled();
    });

    it("rechecks GitHub on the next request after a successful cached response", async () => {
      const response = await invoke();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.token).toHaveBeenCalledWith("user-a");
      mocks.cache.mockClear(); mocks.learningRecord.mockClear();
      mocks.json.mockResolvedValue({ total_count: 0, installations: [] });
      expect((await invoke()).status).toBe(403);
      expect(mocks.cache).not.toHaveBeenCalled();
      expect(mocks.learningRecord).not.toHaveBeenCalled();
    });
  });
}

it("does not expose or cache analysis if access is lost while collecting source", async () => {
  mocks.load.mockImplementation(async () => {
    mocks.json.mockResolvedValue({ total_count: 0, installations: [] });
    return { repository: "org/private", sources: [], collection: { commitSha: "sha" } };
  });
  const response = await GET(new Request("http://localhost/analyze"), params());
  expect(response.status).toBe(403);
  expect(mocks.cache).not.toHaveBeenCalled();
  expect(mocks.storeCache).not.toHaveBeenCalled();
});

it("does not persist/return AI output if access is lost during generation", async () => {
  mocks.learningRecord.mockResolvedValue(null);
  mocks.generate.mockImplementation(async () => {
    mocks.json.mockResolvedValue({ total_count: 0, installations: [] });
    return { explanation: "generated secret", usage: {} };
  });
  const response = await POST(request(), params());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("generated secret");
  expect(mocks.saveLearning).not.toHaveBeenCalled();
});

it("keeps normal AI generation working after fresh authorization", async () => {
  mocks.learningRecord.mockResolvedValue(null);
  const response = await POST(request(), params());
  expect(response.status).toBe(200);
  expect(mocks.generate).toHaveBeenCalledOnce();
  expect(mocks.saveLearning).toHaveBeenCalledOnce();
  expect(mocks.token).toHaveBeenCalledTimes(2);
});

it("keeps uncached authorized source analysis working", async () => {
  mocks.cache.mockReturnValue(undefined);
  const response = await GET(new Request("http://localhost/analyze"), params());
  expect(response.status).toBe(200);
  expect(mocks.analyze).toHaveBeenCalledOnce();
  expect(mocks.storeCache).toHaveBeenCalledWith("installation:7:org/private@sha", expect.objectContaining({ source: "github" }));
});

it("retains the user scope on cached AI explanations and the latest analysis", async () => {
  const response = await POST(request(), params());
  expect(response.status).toBe(200);
  expect(mocks.latestRun).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ requestedByUserId: "user-a", repositoryId: "repo-1" }) }));
  expect(mocks.learningRecord).toHaveBeenCalledWith({ where: { userId_cacheKey: { userId: "user-a", cacheKey: "learning-cache" } } });
  expect(mocks.generate).not.toHaveBeenCalled();
});
