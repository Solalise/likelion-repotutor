import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), latest: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("@/lib/github/latestRepositoryCommit", () => ({ latestRepositoryCommit: mocks.latest }));
vi.mock("@/lib/github/repositoryAccess", () => ({
  RepositoryAccessError: class extends Error { constructor(message: string, public status: number) { super(message); } },
  requireRepositoryAccess: mocks.access,
  repositoryJson: (data: unknown, init?: ResponseInit) => Response.json(data, init),
  repositoryAccessResponse: (error: { status: number }) => Response.json({ message: "denied" }, { status: error.status }),
}));
import { GET } from "./route";
import { RepositoryAccessError } from "@/lib/github/repositoryAccess";
const context = { params: Promise.resolve({ connectionId: "own" }) };
const request = () => new Request("https://example.org/api/repositories/own/latest-commit");
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue("user");
  mocks.access.mockResolvedValue({ repository: { fullName: "org/app", defaultBranch: "main" }, installation: { installationId: "42" } });
  mocks.latest.mockResolvedValue({ sha: "a".repeat(40), branch: "main", checkedAt: "2026-11-24T00:00:00Z" });
});
it("uses the authorized server branch without reading or writing analysis data", async () => {
  const response = await GET(request(), context); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ repository: "org/app", sha: "a".repeat(40), branch: "main" });
  expect(mocks.latest).toHaveBeenCalledWith({ userId: "user", connectionId: "own", installationId: "42", repository: "org/app", branch: "main" });
  expect(mocks.access).toHaveBeenCalledTimes(2);
});
it("requires authentication and fresh access even if SHA metadata is available", async () => {
  mocks.user.mockRejectedValueOnce(new Error()); expect((await GET(request(), context)).status).toBe(401);
  mocks.access.mockRejectedValueOnce(new RepositoryAccessError("denied", 404)); expect((await GET(request(), context)).status).toBe(404);
  expect(mocks.latest).not.toHaveBeenCalled();
  mocks.access.mockResolvedValueOnce({ repository: { fullName: "org/app", defaultBranch: "main" }, installation: { installationId: "42" } })
    .mockRejectedValueOnce(new RepositoryAccessError("revoked", 403));
  expect((await GET(request(), context)).status).toBe(403);
});
it("returns a safe lookup failure without exposing server details", async () => {
  mocks.latest.mockRejectedValueOnce(new Error("Prisma C:/server/path token=PRIVATE"));
  const response = await GET(request(), context); expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/Prisma|server|PRIVATE/);
});
