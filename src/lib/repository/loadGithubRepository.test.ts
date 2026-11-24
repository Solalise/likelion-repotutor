import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
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

it("refreshes the branch commit for explicit reanalysis inside the freshness window", async () => {
  let currentSha = SHA;
  const nextSha = "b".repeat(40), calls: string[] = [];
  const base = repositoryFetcher([{ path: "app/page.ts", content: "export const value = 1;" }], []);
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/commits/main")) return jsonResponse({ sha: currentSha });
    if (url.endsWith(`/tar.gz/${nextSha}`)) return base(`https://codeload.github.com/acme/project/tar.gz/${SHA}`, init);
    return base(input, init);
  };
  await loadGithubRepository("https://github.com/acme/project", fetcher, "installation:42");
  currentSha = nextSha;
  const next = await loadGithubRepository("https://github.com/acme/project", fetcher, "installation:42", { refresh: true });
  expect(next.collection.commitSha).toBe(nextSha);
  expect(calls.filter(url => url.endsWith("/commits/main"))).toHaveLength(2);
  expect(calls).toContain(`https://codeload.github.com/acme/project/tar.gz/${nextSha}`);
  const before = calls.length;
  const same = await loadGithubRepository("https://github.com/acme/project", fetcher, "installation:42", { refresh: true });
  expect(same.collection).toMatchObject({ commitSha: nextSha, cached: true });
  expect(calls.slice(before)).toEqual(["https://api.github.com/repos/acme/project", "https://api.github.com/repos/acme/project/commits/main"]);
});

it("collects package metadata separately from AST sources", async () => {
  const result = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher([{ path: "package.json", content: JSON.stringify({ dependencies: { next: "1", mongoose: "1" } }) }, { path: "app/actions.ts", content: "export const x=1;" }], []));
  expect(result.collection.packageManifests).toEqual([{ path: "package.json", dependencies: ["next", "mongoose"] }]);
  expect(result.sources.map(s => s.path)).toEqual(["app/actions.ts"]);
});

it("accounts for all 107 regular files and records exact exclusions instead of losing them before indexing", async () => {
  const files = [
    ...Array.from({ length: 100 }, (_, i) => ({ path: `src/file${i}.ts`, content: `export const value${i} = ${i};` })),
    { path: "src/View.TSX", content: "export const View = () => <p>ok</p>;" },
    { path: "server.py", content: "print('synthetic')" },
    { path: "src/generated.ts", content: "export const generated = true;" },
    { path: "fixtures/unsafe.ts", content: "export const fixture = true;" },
    { path: "src/empty.ts", content: "" },
    { path: "src/large.ts", content: "x".repeat(256 * 1024 + 1) },
    { path: "package.json", content: "{}" },
  ];
  const result = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(files, []));
  expect(result.collection).toMatchObject({ repositoryFiles: 107, analyzableFiles: 101, collectedFiles: 101, excludedFiles: 6, partial: false });
  expect(result.collection.manifest).toHaveLength(107);
  expect(result.sources.some(s => s.path === "src/View.TSX")).toBe(true);
  expect(analyzeSourceFiles(result.sources).files).toHaveLength(101);
  for (const [path, reason] of [["server.py", "unsupported-language"], ["src/generated.ts", "generated-file"], ["fixtures/unsafe.ts", "excluded-directory"], ["src/empty.ts", "empty-file"], ["src/large.ts", "file-size-limit"]]) {
    expect(result.collection.manifest.find(f => f.path === path)).toMatchObject({ status: "excluded", reason });
  }
});

it("reports unsupported-only repositories without claiming successful language coverage", async () => {
  const result = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher([{ path: "api.py", content: "pass" }], []));
  expect(result.sources).toEqual([]);
  expect(result.collection).toMatchObject({ repositoryFiles: 1, analyzableFiles: 0, collectedFiles: 0, excludedFiles: 1 });
});

it("records file-count and byte-limit exclusions on the actual omitted paths", async () => {
  const count = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(Array.from({ length: 205 }, (_, i) => ({ path: `src/f${i}.ts`, content: "export const x = 1;" })), []));
  expect(count.sources).toHaveLength(200);
  expect(count.collection.manifest.filter(f => f.reason === "file-count-limit")).toHaveLength(5);
  clearGithubRepositoryCachesForTests();
  const bytes = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(Array.from({ length: 40 }, (_, i) => ({ path: `src/f${i}.ts`, content: "/**" + "x".repeat(240 * 1024) + "*/" })), []));
  expect(bytes.collection.partial).toBe(true);
  expect(bytes.collection.totalBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(bytes.collection.manifest.filter(f => f.reason === "total-byte-limit")).toHaveLength(40 - bytes.sources.length);
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
    expect(result.collection).toMatchObject({
      commitSha: SHA,
      discoveredFiles: GITHUB_COLLECTION_LIMITS.maxFiles + 3,
      indexedFiles: GITHUB_COLLECTION_LIMITS.maxFiles + 3,
      collectedFiles: GITHUB_COLLECTION_LIMITS.maxFiles,
      skippedByFileLimit: 3,
      partial: true,
      cached: false,
      apiRequestCount: 2,
    });
    expect(result.collection.notice).toContain(`${GITHUB_COLLECTION_LIMITS.maxFiles + 3}개 중 ${GITHUB_COLLECTION_LIMITS.maxFiles}개`);
    expect(calls.filter((url) => url.startsWith("https://api.github.com/"))).toHaveLength(2);
    expect(calls.some((url) => url.includes("/git/blobs/") || url.includes("/git/trees/"))).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("indexes the archive and includes transitive imports and matching API routes before filler files", async () => {
    const filler = Array.from({ length: 70 }, (_, index) => ({
      path: `apps/mobile/app/filler-${String(index).padStart(2, "0")}/page.tsx`,
      content: `export function Filler${index}() { return null; }`,
    }));
    const files = [
      ...filler,
      {
        path: "apps/mobile/src/screens/Lookup.tsx",
        content: `import { service } from "@/z/service"; export function LookupScreen() { return service.lookup(); }`,
      },
      {
        path: "apps/mobile/src/z/service.ts",
        content: `export const service = { lookup() { return fetch("/api/cases/auth", { method: "POST" }); } };`,
      },
      {
        path: "apps/web/src/app/api/cases/auth/route.ts",
        content: `export async function POST() { return Response.json({ ok: true }); }`,
      },
    ];
    const result = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(files, []));
    const selectedPaths = result.sources.map((source) => source.path);
    expect(selectedPaths).toEqual(expect.arrayContaining([
      "apps/mobile/src/screens/Lookup.tsx",
      "apps/mobile/src/z/service.ts",
      "apps/web/src/app/api/cases/auth/route.ts",
    ]));
    expect(result.collection).toMatchObject({ indexedFiles: files.length, dependencyFiles: expect.any(Number) });
    expect(result.collection.dependencyFiles).toBeGreaterThanOrEqual(2);
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

  it("isolates source and in-flight caches by authentication namespace", async () => {
    const publicCalls: string[] = [];
    const privateCalls: string[] = [];
    const files = [{ path: "src/index.ts", content: "export const x = 1;" }];
    await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(files, publicCalls), "public");
    const connected = await loadGithubRepository("https://github.com/acme/project", repositoryFetcher(files, privateCalls), "installation:123");
    expect(connected.collection.cached).toBe(false);
    expect(publicCalls).toHaveLength(3);
    expect(privateCalls).toHaveLength(3);
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
