import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadGithubRepositoryMock, analyzeSourceFilesMock } = vi.hoisted(() => ({
  loadGithubRepositoryMock: vi.fn(),
  analyzeSourceFilesMock: vi.fn(),
}));

vi.mock("@/lib/repository/loadGithubRepository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/repository/loadGithubRepository")>();
  return { ...original, loadGithubRepository: loadGithubRepositoryMock };
});

vi.mock("@/lib/ast/analyzer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ast/analyzer")>();
  analyzeSourceFilesMock.mockImplementation(original.analyzeSourceFiles);
  return { ...original, analyzeSourceFiles: analyzeSourceFilesMock };
});

import { clearGithubAnalysisCacheForTests } from "@/lib/repository/githubAnalysisCache";
import { GET } from "./route";

describe("GET /api/analyze", () => {
  beforeEach(() => {
    loadGithubRepositoryMock.mockReset();
    analyzeSourceFilesMock.mockClear();
    clearGithubAnalysisCacheForTests();
  });

  it("keeps the sample repository analysis path working", async () => {
    const response = await GET(new Request("http://localhost/api/analyze?source=sample"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      repository: "sample-repository",
      source: "sample",
      stats: { files: 4, functions: 5 },
      collection: { partial: false, collectedFiles: 4 },
    });
  });

  it("loads GitHub sources and passes them to the existing analyzer", async () => {
    loadGithubRepositoryMock.mockResolvedValue({
      repository: "acme/project",
      sources: [{ path: "src/index.ts", content: "export function hello() { return 'hello'; }" }],
      collection: {
        repositoryUrl: "https://github.com/acme/project",
        defaultBranch: "main",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        discoveredFiles: 1,
        collectedFiles: 1,
        totalBytes: 46,
        durationMs: 10,
        partial: false,
        treeTruncated: false,
        archiveBytes: 100,
        cached: false,
        apiRequestCount: 2,
      },
    });

    const response = await GET(new Request("http://localhost/api/analyze?source=github&url=https%3A%2F%2Fgithub.com%2Facme%2Fproject"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(loadGithubRepositoryMock).toHaveBeenCalledWith("https://github.com/acme/project");
    expect(payload).toMatchObject({
      repository: "acme/project",
      source: "github",
      stats: { files: 1, functions: 1 },
      collection: { source: "github", defaultBranch: "main" },
    });
  });

  it("reuses the AST result for the same commit SHA", async () => {
    loadGithubRepositoryMock.mockResolvedValue({
      repository: "acme/project",
      sources: [{ path: "src/index.ts", content: "export function hello() { return 'hello'; }" }],
      collection: {
        repositoryUrl: "https://github.com/acme/project",
        defaultBranch: "main",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        discoveredFiles: 1,
        collectedFiles: 1,
        totalBytes: 46,
        archiveBytes: 100,
        durationMs: 10,
        partial: false,
        treeTruncated: false,
        cached: false,
        apiRequestCount: 0,
      },
    });
    const requestUrl = "http://localhost/api/analyze?source=github&url=https%3A%2F%2Fgithub.com%2Facme%2Fproject";
    await GET(new Request(requestUrl));
    const second = await GET(new Request(requestUrl));
    const payload = await second.json();
    expect(analyzeSourceFilesMock).toHaveBeenCalledTimes(1);
    expect(payload.collection.cached).toBe(true);
  });

  it("rejects a GitHub analysis request without a URL", async () => {
    const response = await GET(new Request("http://localhost/api/analyze?source=github"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining("URL") });
  });
});
