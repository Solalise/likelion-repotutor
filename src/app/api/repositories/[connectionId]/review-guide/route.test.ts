import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), run: vi.fn(), cache: vi.fn(), generate: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { analysisRun: { findFirst: mocks.run, update: mocks.update } } }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: mocks.access, repositoryJson: (data: unknown, init?: ResponseInit) => Response.json(data, init), repositoryAccessResponse: () => Response.json({ message: "denied" }, { status: 403 }) }));
vi.mock("@/lib/repository/githubAnalysisCache", () => ({ getGithubAnalysisCache: mocks.cache, githubAnalysisCacheKey: (...keys: string[]) => keys.join(":") }));
vi.mock("@/lib/ai/securityReviewGuide", () => ({ generateSecurityGuides: mocks.generate }));
import { POST } from "./route";
import { serializeAnalysis } from "@/lib/repository/persistedAnalysis";
import type { RepositoryAnalysis } from "@/types/analysis";
const sha = "a".repeat(40), context = { params: Promise.resolve({ connectionId: "own" }) };
const request = (origin = "https://vulnlab.example") => new Request("https://vulnlab.example/api/repositories/own/review-guide", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ commitSha: sha }) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue("user"); mocks.access.mockResolvedValue({ repositoryId: "repo", repository: { fullName: "org/app" }, installation: { installationId: "42" } }); mocks.run.mockResolvedValue({ id: "run" }); mocks.cache.mockReturnValue({ repository: "org/app" }); mocks.generate.mockResolvedValue({ guides: [], origin: "ai" }); });
it("requires authentication, same origin and current repository access before using source context", async () => {
  expect((await POST(request("https://untrusted.example"), context)).status).toBe(403); expect(mocks.generate).not.toHaveBeenCalled();
  mocks.user.mockRejectedValueOnce(new Error()); expect((await POST(request(), context)).status).toBe(401);
  mocks.access.mockRejectedValueOnce(new Error()); expect((await POST(request(), context)).status).toBe(403); expect(mocks.generate).not.toHaveBeenCalled();
});
it("requires the user's completed commit and cached server analysis, never client-provided code", async () => {
  mocks.run.mockResolvedValueOnce(null); expect((await POST(request(), context)).status).toBe(409);
  mocks.cache.mockReturnValueOnce(undefined); expect((await POST(request(), context)).status).toBe(409); expect(mocks.generate).not.toHaveBeenCalled();
});
it("returns four-type generated guides bound to the requested analysis and rechecks access", async () => {
  const response = await POST(request(), context); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ repository: "org/app", commitSha: sha });
  expect(mocks.generate).toHaveBeenCalledWith({ repository: "org/app" }, "user:own"); expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(mocks.run).toHaveBeenCalledWith({ where: { requestedByUserId: "user", repositoryId: "repo", source: "CONNECTED_REPOSITORY", commitSha: sha, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
});

const savedAnalysis: RepositoryAnalysis = { repository: "org/app", source: "github", files: [], nodes: [], edges: [], stats: { files: 0, functions: 0, relations: 0 },
  collection: { source: "github", commitSha: sha, discoveredFiles: 0, collectedFiles: 0, totalBytes: 0, durationMs: 0, partial: false } };
it("returns persisted validated AI guides after memory expiry without calling Groq", async () => {
  const stored = serializeAnalysis(savedAnalysis), guide = { ...stored.baseGuide, origin: "ai" };
  mocks.run.mockResolvedValueOnce({ id: "run", commitSha: sha, analysisResult: stored, reviewGuide: guide });
  mocks.cache.mockReturnValue(undefined);
  const response = await POST(request(), context);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ origin: "ai", cached: true, commitSha: sha });
  expect(mocks.cache).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});
it("saves only the generator's validated AI bundle and keeps fallback responses from overwriting it", async () => {
  const stored = serializeAnalysis(savedAnalysis);
  mocks.run.mockResolvedValue({ id: "run", commitSha: sha, analysisResult: stored });
  mocks.generate.mockResolvedValueOnce({ ...stored.baseGuide, origin: "ai" });
  expect((await POST(request(), context)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "run" }, data: { reviewGuide: expect.objectContaining({ origin: "ai" }) } });
  mocks.update.mockClear(); mocks.generate.mockResolvedValueOnce(stored.baseGuide);
  expect((await POST(request(), context)).status).toBe(200); expect(mocks.update).not.toHaveBeenCalled();
});
