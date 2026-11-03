import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub installation fetcher", () => {
  it("rewrites codeload downloads to the authenticated archive API", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/repotutor");
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("archive", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createInstallationFetcher } = await import("./appAuthentication");
    const installationFetch = createInstallationFetcher("installation-secret");
    await installationFetch("https://codeload.github.com/acme/project/tar.gz/0123456789abcdef0123456789abcdef01234567");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/acme/project/tarball/0123456789abcdef0123456789abcdef01234567");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer installation-secret");
  });

  it("rejects non-GitHub targets before sending a token", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/repotutor");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { createInstallationFetcher } = await import("./appAuthentication");
    await expect(createInstallationFetcher("secret")("https://example.com/archive.tar.gz")).rejects.toThrow(/허용되지 않은/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
