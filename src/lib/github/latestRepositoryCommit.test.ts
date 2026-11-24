import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), fetcher: vi.fn() }));
vi.mock("./appAuthentication", () => ({ getInstallationAccessToken: mocks.token, createInstallationFetcher: () => mocks.fetcher }));
import { latestRepositoryCommit } from "./latestRepositoryCommit";
const input = { userId: "user", connectionId: "own", installationId: "42", repository: "org/app", branch: "feature/new" };
beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue("private-token"); });

it("requests only SHA metadata for the encoded target branch and coalesces concurrent checks", async () => {
  let resolve!: (response: Response) => void;
  mocks.fetcher.mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = latestRepositoryCommit(input), second = latestRepositoryCommit(input);
  await vi.waitFor(() => expect(mocks.fetcher).toHaveBeenCalledTimes(1));
  resolve(new Response("a".repeat(40)));
  const [a, b] = await Promise.all([first, second]);
  expect(a).toEqual(b); expect(a).toMatchObject({ sha: "a".repeat(40), branch: "feature/new" });
  expect(mocks.fetcher).toHaveBeenCalledWith("https://api.github.com/repos/org/app/commits/feature%2Fnew", expect.objectContaining({ headers: { Accept: "application/vnd.github.sha" }, cache: "no-store" }));
  mocks.fetcher.mockResolvedValueOnce(new Response("b".repeat(40)));
  expect(await latestRepositoryCommit(input)).toMatchObject({ sha: "b".repeat(40) });
  expect(mocks.fetcher).toHaveBeenCalledTimes(2);
});

it("rejects malformed or failed responses and lets a later request retry", async () => {
  mocks.fetcher.mockResolvedValueOnce(new Response("private internal error", { status: 403 }))
    .mockResolvedValueOnce(new Response("invalid sha"))
    .mockResolvedValueOnce(new Response("c".repeat(40)));
  await expect(latestRepositoryCommit(input)).rejects.toThrow("COMMIT_LOOKUP_FAILED");
  await expect(latestRepositoryCommit(input)).rejects.toThrow("INVALID_COMMIT_SHA");
  expect(await latestRepositoryCommit(input)).toMatchObject({ sha: "c".repeat(40) });
});
