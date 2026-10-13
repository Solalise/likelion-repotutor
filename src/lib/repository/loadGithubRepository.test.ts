import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGithubRepositoryCachesForTests,
  GITHUB_COLLECTION_LIMITS,
  GithubRepositoryError,
  loadGithubRepository,
  parseGithubRepositoryUrl,
} from "./loadGithubRepository";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function writeAscii(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.write(value.slice(0, length), offset, "ascii");
}

function tarGzip(files: Array<{ path: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const content = Buffer.from(file.content);
    const header = Buffer.alloc(512);
    writeAscii(header, `project-${SHA}/${file.path}`, 0, 100);
    writeAscii(header, "0000644\0", 100, 8);
    writeAscii(header, "0000000\0", 108, 8);
    writeAscii(header, "0000000\0", 116, 8);
    writeAscii(header, `${content.length.toString(8).padStart(11, "0")}\0`, 124, 12);
    writeAscii(header, "00000000000\0", 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    writeAscii(header, "ustar\0", 257, 6);
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function repositoryFetcher(files: Array<{ path: string; content: string }>, calls: string[], initCalls: RequestInit[] = []): typeof fetch {
  const archive = tarGzip(files);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    initCalls.push(init ?? {});
    if (url === "https://api.github.com/repos/acme/project") return jsonResponse({ default_branch: "main", full_name: "acme/project" });
    if (url === "https://api.github.com/repos/acme/project/commits/main") return jsonResponse({ sha: SHA });
    if (url === `https://codeload.github.com/acme/project/tar.gz/${SHA}`) {
      const body = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      return new Response(body, { status: 200, headers: { "content-length": String(archive.length) } });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
}

beforeEach(() => {
  clearGithubRepositoryCachesForTests();
  vi.useRealTimers();
  delete process.env.GITHUB_TOKEN;
});
afterEach(() => delete process.env.GITHUB_TOKEN);

describe("parseGithubRepositoryUrl", () => {
  it("accepts only an exact public GitHub repository URL", () => {
    expect(parseGithubRepositoryUrl("https://github.com/openai/openai-node")).toMatchObject({ owner: "openai", repo: "openai-node", fullName: "openai/openai-node" });
    expect(parseGithubRepositoryUrl("https://github.com/openai/openai-node.git/").repo).toBe("openai-node");
  });

  it.each([
    "http://github.com/openai/openai-node", "https://github.com.evil.test/openai/openai-node",
    "https://github.com/openai/openai-node/tree/main", "https://github.com/openai/openai-node?redirect=https://example.com",
    "https://user@github.com/openai/openai-node", "https://github.com/bad--owner/repo",
  ])("rejects an unsafe or malformed URL: %s", (url) => {
    expect(() => parseGithubRepositoryUrl(url)).toThrow(GithubRepositoryError);
  });
});

describe("loadGithubRepository", () => {
  it("uses two REST API calls and one archive request instead of per-file blob requests", async () => {
    const files = Array.from({ length: GITHUB_COLLECTION_LIMITS.maxFiles + 3 }, (_, index) => ({
      path: `src/file-${String(index).padStart(2, "0")}.ts`, content: "export const value = 1;\n",
    }));
    files.push(
      { path: "node_modules/pkg/index.js", content: "ignored" },
      { path: "dist/bundle.js", content: "ignored" },
      { path: "test/fixtures/input.ts", content: "ignored" },
      { path: "src/schema.generated.ts", content: "ignored" },
      { path: "src/types.d.ts", content: "ignored" },
    );
    const calls: string[] = [];
    const result = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(files, calls));

    expect(result.sources).toHaveLength(GITHUB_COLLECTION_LIMITS.maxFiles);
    expect(result.collection).toMatchObject({ commitSha: SHA, discoveredFiles: 43, collectedFiles: 40, partial: true, cached: false, apiRequestCount: 2 });
    expect(result.collection.notice).toContain("43개 중 40개");
    expect(calls.filter((url) => url.startsWith("https://api.github.com/"))).toHaveLength(2);
    expect(calls.some((url) => url.includes("/git/blobs/") || url.includes("/git/trees/"))).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("reuses the same commit without another GitHub request", async () => {
    const calls: string[] = [];
    const fetcher = repositoryFetcher([{ path: "src/index.ts", content: "export const x = 1;" }], calls);
    const first = await loadGithubRepository("https://github.com/acme/project", fetcher);
    const second = await loadGithubRepository("https://github.com/acme/project", fetcher);
    expect(first.collection.cached).toBe(false);
    expect(second.collection).toMatchObject({ cached: true, apiRequestCount: 0, commitSha: SHA });
    expect(calls).toHaveLength(3);
  });

  it("revalidates the commit after the freshness window but reuses unchanged sources", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const calls: string[] = [];
    const fetcher = repositoryFetcher([{ path: "src/index.ts", content: "export const x = 1;" }], calls);
    await loadGithubRepository("https://github.com/acme/project", fetcher);
    vi.advanceTimersByTime(GITHUB_COLLECTION_LIMITS.freshnessTtlMs + 1);
    const second = await loadGithubRepository("https://github.com/acme/project", fetcher);
    expect(second.collection).toMatchObject({ cached: true, apiRequestCount: 1 });
    expect(calls.filter((url) => url.includes("/commits/main"))).toHaveLength(2);
    expect(calls.filter((url) => url.startsWith("https://codeload.github.com/"))).toHaveLength(1);
  });

  it("adds a server token only to GitHub API requests", async () => {
    process.env.GITHUB_TOKEN = "server-secret";
    const calls: string[] = [];
    const initCalls: RequestInit[] = [];
    await loadGithubRepository("https://github.com/acme/project", repositoryFetcher([{ path: "index.ts", content: "export const x = 1;" }], calls, initCalls));
    expect(new Headers(initCalls[0].headers).get("authorization")).toBe("Bearer server-secret");
    expect(new Headers(initCalls[1].headers).get("authorization")).toBe("Bearer server-secret");
    expect(new Headers(initCalls[2].headers).get("authorization")).toBeNull();
  });

  it("works without a token", async () => {
    const calls: string[] = [];
    const initCalls: RequestInit[] = [];
    await loadGithubRepository("https://github.com/acme/project", repositoryFetcher([{ path: "index.ts", content: "export const x = 1;" }], calls, initCalls));
    expect(new Headers(initCalls[0].headers).get("authorization")).toBeNull();
  });

  it("returns primary rate-limit reset guidance", async () => {
    const reset = Math.floor((Date.now() + 120_000) / 1000);
    const fetcher = async () => jsonResponse({ message: "rate limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) });
    await expect(loadGithubRepository("https://github.com/acme/project", fetcher as typeof fetch))
      .rejects.toMatchObject({ status: 429, message: expect.stringMatching(/기본 요청 한도.*2분/) });
  });

  it("falls back to the fixed HEAD archive when the unauthenticated REST limit is exhausted", async () => {
    const archive = tarGzip([{ path: "src/index.ts", content: "export const x = 1;" }]);
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://api.github.com/repos/acme/project") {
        return jsonResponse({}, 403, { "x-ratelimit-remaining": "0" });
      }
      if (url === "https://github.com/acme/project/archive/HEAD.tar.gz") {
        return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/acme/project/tar.gz/${SHA}` } });
      }
      const body = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      return new Response(body, { status: 200, headers: { "content-length": String(archive.length) } });
    }) as typeof fetch;
    const result = await loadGithubRepository("https://github.com/acme/project", fetcher);
    expect(result.collection).toMatchObject({ defaultBranch: "HEAD", commitSha: SHA, apiRequestCount: 1 });
    expect(calls).toEqual([
      "https://api.github.com/repos/acme/project",
      "https://github.com/acme/project/archive/HEAD.tar.gz",
      `https://codeload.github.com/acme/project/tar.gz/${SHA}`,
    ]);
  });

  it("distinguishes authentication and secondary limits", async () => {
    await expect(loadGithubRepository("https://github.com/acme/project", (async () => jsonResponse({}, 401)) as typeof fetch))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("인증") });
    clearGithubRepositoryCachesForTests();
    await expect(loadGithubRepository("https://github.com/acme/project", (async () => jsonResponse({}, 403, { "retry-after": "60" })) as typeof fetch))
      .rejects.toMatchObject({ status: 429, message: expect.stringContaining("secondary") });
  });

  it("rejects archive path traversal", async () => {
    const calls: string[] = [];
    const fetcher = repositoryFetcher([{ path: "../escape.ts", content: "export const bad = 1;" }], calls);
    await expect(loadGithubRepository("https://github.com/acme/project", fetcher))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining("안전하지 않은 경로") });
  });
});

const integrationTest = process.env.RUN_GITHUB_INTEGRATION === "1" ? it : it.skip;
integrationTest("loads the target public GitHub repository", async () => {
  clearGithubRepositoryCachesForTests();
  const result = await loadGithubRepository("https://github.com/team-mallang/likelion-hackathon");
  expect(result.repository.toLowerCase()).toBe("team-mallang/likelion-hackathon");
  expect(result.sources.length).toBeGreaterThan(0);
  expect(result.collection.apiRequestCount).toBeLessThanOrEqual(2);
});
