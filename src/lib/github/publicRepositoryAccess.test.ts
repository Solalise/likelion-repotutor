import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), analyze: vi.fn() }));
vi.mock("@/lib/repository/loadGithubRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/repository/loadGithubRepository")>(), loadGithubRepository: mocks.load,
}));
vi.mock("@/lib/ast/analyzer", () => ({ analyzeSourceFiles: mocks.analyze }));

import { requirePublicRepositoryAccess } from "./publicRepositoryAccess";
import { clearGithubAnalysisCacheForTests } from "@/lib/repository/githubAnalysisCache";
import { GET } from "@/app/api/analyze/route";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  clearGithubAnalysisCacheForTests();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GITHUB_TOKEN", "server-private-repository-token");
  fetchMock.mockImplementation(async () => Response.json({ private: false, full_name: "org/project" }));
  mocks.load.mockResolvedValue({ repository: "org/project", sources: [], collection: { commitSha: "sha" } });
  mocks.analyze.mockReturnValue({ repository: "org/project", nodes: [], edges: [], entryPoints: [], stats: {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("public URL authorization", () => {
  it("checks without the configured server credential and without HTTP caching", async () => {
    await requirePublicRepositoryAccess("https://github.com/org/project");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/org/project");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(init.cache).toBe("no-store");
  });

  it.each([
    [{ private: true, full_name: "org/project" }, 403],
    [{ full_name: "org/project" }, 403],
    [{ private: false, full_name: "another/project" }, 403],
  ])("rejects private, unverifiable, or mismatched metadata", async (body, status) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(requirePublicRepositoryAccess("https://github.com/org/project")).rejects.toMatchObject({ status });
  });

  it.each([401, 403, 429, 500])("fails closed when anonymous GitHub verification returns %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(requirePublicRepositoryAccess("https://github.com/org/project")).rejects.toMatchObject({ status: 503 });
  });

  it("blocks an inaccessible repository before source collection", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const response = await GET(new Request("http://localhost/api/analyze?source=github&url=https://github.com/org/project"));
    expect(response.status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("blocks a formerly public repository even if its AST cache is warm", async () => {
    const url = "http://localhost/api/analyze?source=github&url=https://github.com/org/project";
    expect((await GET(new Request(url))).status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledOnce();
    mocks.load.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    const response = await GET(new Request(url));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("blocks data if the repository becomes inaccessible during collection", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ private: false, full_name: "org/project" }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const response = await GET(new Request("http://localhost/api/analyze?source=github&url=https://github.com/org/project"));
    expect(response.status).toBe(404);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("does not fall back to cached output on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const response = await GET(new Request("http://localhost/api/analyze?source=github&url=https://github.com/org/project"));
    expect(response.status).toBe(503);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("keeps normal public analysis and AST cache reuse working", async () => {
    const url = "http://localhost/api/analyze?source=github&url=https://github.com/org/project";
    expect((await GET(new Request(url))).status).toBe(200);
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect((await response.json()).collection.cached).toBe(true);
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
