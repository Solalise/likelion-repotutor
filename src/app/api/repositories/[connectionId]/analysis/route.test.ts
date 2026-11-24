import { beforeEach, expect, it, vi } from "vitest";
import { serializeAnalysis } from "@/lib/repository/persistedAnalysis";
import type { RepositoryAnalysis } from "@/types/analysis";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { analysisRun: { findFirst: mocks.find } } }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: mocks.access,
  repositoryJson: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  repositoryAccessResponse: () => Response.json({ message: "denied" }, { status: 403 }) }));
import { GET } from "./route";
const sha = "a".repeat(40), context = { params: Promise.resolve({ connectionId: "own" }) };
const request = () => new Request("https://example.org/api/repositories/own/analysis");
const analysis: RepositoryAnalysis = { repository: "org/app", source: "github", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 },
  collection: { source: "github", commitSha: sha, discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, durationMs: 0, partial: false } };
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue("user"); mocks.access.mockResolvedValue({ repositoryId: "repo", repository: { fullName: "org/app" } });
  mocks.find.mockResolvedValue({ analysisResult: serializeAnalysis(analysis), commitSha: sha, completedAt: new Date("2026-11-24T00:00:00Z") }); });
it("restores the user's last successful durable snapshot without depending on memory cache", async () => {
  const response = await GET(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ analysis: { repository: "org/app", analyzedAt: "2026-11-24T00:00:00.000Z", collection: { commitSha: sha }, savedReviewGuides: { origin: "fallback" } } });
  expect(mocks.find.mock.calls[0][0].where).toMatchObject({ requestedByUserId: "user", repositoryId: "repo", source: "CONNECTED_REPOSITORY", status: "COMPLETED" });
  expect(mocks.access).toHaveBeenCalledTimes(2);
});
it("distinguishes missing and unreadable results", async () => {
  mocks.find.mockResolvedValueOnce(null); expect(await (await GET(request(), context)).json()).toEqual({ analysis: null });
  mocks.find.mockResolvedValueOnce({ analysisResult: { version: 999 } }); expect((await GET(request(), context)).status).toBe(422);
});
it("checks authentication and repository access before DB reads and rechecks before returning", async () => {
  mocks.user.mockRejectedValueOnce(new Error()); expect((await GET(request(), context)).status).toBe(401); expect(mocks.find).not.toHaveBeenCalled();
  mocks.access.mockRejectedValueOnce(new Error()); expect((await GET(request(), context)).status).toBe(403); expect(mocks.find).not.toHaveBeenCalled();
  mocks.access.mockResolvedValueOnce({ repositoryId: "repo", repository: { fullName: "org/app" } }).mockRejectedValueOnce(new Error());
  expect((await GET(request(), context)).status).toBe(403);
});
