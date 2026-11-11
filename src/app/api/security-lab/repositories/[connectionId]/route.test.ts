import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), connection: vi.fn(), list: vi.fn(), revoke: vi.fn(), token: vi.fn(), json: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { userRepository: { findFirst: mocks.connection, findMany: mocks.list, updateMany: mocks.revoke } } }));
vi.mock("@/lib/github/api", async (original) => ({ ...await original<typeof import("@/lib/github/api")>(), getGitHubUserAccessToken: mocks.token, githubJson: mocks.json }));
vi.mock("@/lib/github/installations", async (original) => ({ ...await original<typeof import("@/lib/github/installations")>(), syncAllUserInstallations: mocks.sync }));

import { GET } from "./route";
import { GET as listRepositories } from "@/app/api/github/repositories/route";

const connection = {
  id: "own-connection", userId: "user-a", active: true, permission: "READ",
  repository: { githubRepositoryId: "21", fullName: "org/project", defaultBranch: "main", htmlUrl: "https://github.com/org/project", visibility: "PRIVATE" },
  installation: { userId: "user-a", installationId: "7", accountLogin: "org" },
};
const invoke = (id = "own-connection", query = "") => GET(new Request(`http://localhost/api/security-lab/repositories/${id}${query}`), { params: Promise.resolve({ connectionId: id }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue("user-a");
  mocks.connection.mockImplementation(async ({ where }) => where.id === connection.id && where.userId === connection.userId && where.active ? connection : null);
  mocks.list.mockResolvedValue([connection]);
  mocks.token.mockResolvedValue("github-user-token");
  mocks.json.mockImplementation(async (path: string) => path.endsWith("/contents") ? [] : path.startsWith("/user/installations?")
    ? { total_count: 1, installations: [{ id: 7, suspended_at: null, permissions: { contents: "read" } }] }
    : { total_count: 1, repositories: [{ id: 21, full_name: "org/project", permissions: { pull: true } }] });
});

describe("Security Lab selection authorization using existing GitHub checks", () => {
  it("requires login for both metadata and the reused list API", async () => {
    mocks.user.mockRejectedValue(new Error("AUTH_REQUIRED"));
    expect((await invoke()).status).toBe(401);
    expect((await listRepositories()).status).toBe(401);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("reuses the existing synchronized, user-scoped list API", async () => {
    const response = await listRepositories();
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("user-a");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-a", active: true } }));
    expect(await response.json()).toMatchObject([{ id: "own-connection", repository: { fullName: "org/project" } }]);
  });
  it("returns only authorized metadata, without credentials or source code", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ id: "own-connection", repository: { fullName: "org/project", defaultBranch: "main" } });
    expect(mocks.json).toHaveBeenCalledWith("/repos/org/project/contents", "github-user-token", expect.any(Object));
  });
  it("blocks user B using user A's real connection ID before contacting GitHub", async () => {
    mocks.user.mockResolvedValue("user-b");
    expect((await invoke()).status).toBe(404);
    expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "own-connection", userId: "user-b", active: true } }));
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("blocks unknown IDs and rejects URL/proxy parameters", async () => {
    expect((await invoke("other-connection")).status).toBe(404);
    expect((await invoke("bad.id")).status).toBe(400);
    expect((await invoke("own-connection", "?url=https://example.com")).status).toBe(400);
    expect(mocks.token).not.toHaveBeenCalled();
  });
  it("revalidates revoked GitHub access rather than trusting stored metadata", async () => {
    mocks.json.mockResolvedValue({ total_count: 0, installations: [] });
    expect((await invoke()).status).toBe(403);
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { id: "own-connection", userId: "user-a" }, data: { active: false } });
  });
  it("fails closed when GitHub permissions cannot be verified", async () => {
    mocks.json.mockRejectedValue(new Error("timeout"));
    expect((await invoke()).status).toBe(503);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
