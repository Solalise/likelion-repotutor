import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubInstallationPayload } from "./installations";

const mocks = vi.hoisted(() => ({
  json: vi.fn(), token: vi.fn(), revoke: vi.fn(), installation: vi.fn(), repository: vi.fn(), connection: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  userRepository: { updateMany: mocks.revoke, upsert: mocks.connection },
  gitHubInstallation: { upsert: mocks.installation }, repository: { upsert: mocks.repository },
} }));
vi.mock("./api", () => ({ getGitHubUserAccessToken: mocks.token, githubJson: mocks.json }));

import { findAccessibleInstallation, listAccessibleRepositories, saveAndSyncInstallation, syncAllUserInstallations } from "./installations";

const installation: GitHubInstallationPayload = {
  id: 7, account: { id: 1, login: "org", type: "Organization" }, repository_selection: "selected",
  permissions: { contents: "read" }, suspended_at: null,
};
const repository = {
  id: 21, name: "private", full_name: "org/private", html_url: "https://github.com/org/private",
  default_branch: "main", private: true, archived: false, owner: { login: "org" }, permissions: { pull: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockResolvedValue("user-token");
  mocks.installation.mockResolvedValue({ id: "db-installation" });
  mocks.repository.mockResolvedValue({ id: "db-repository" });
});

describe("installation permission reconciliation", () => {
  it("deactivates all of this user's connections when no installations remain", async () => {
    mocks.json.mockResolvedValue({ total_count: 0, installations: [] });
    await expect(syncAllUserInstallations("user-a")).resolves.toBe(0);
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith({ where: { userId: "user-a" }, data: { active: false } });
  });

  it("deactivates disappeared installations and removed repositories with user scoping", async () => {
    mocks.json.mockResolvedValueOnce({ total_count: 1, installations: [installation] })
      .mockResolvedValueOnce({ total_count: 1, repositories: [repository] });
    await expect(syncAllUserInstallations("user-a")).resolves.toBe(1);
    expect(mocks.revoke).toHaveBeenNthCalledWith(1, {
      where: { userId: "user-a", installation: { installationId: { notIn: ["7"] } } }, data: { active: false },
    });
    expect(mocks.revoke).toHaveBeenNthCalledWith(2, {
      where: { userId: "user-a", installationId: "db-installation", repositoryId: { notIn: ["db-repository"] } }, data: { active: false },
    });
    expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({
      update: { installationId: "db-installation", permission: "READ", active: true },
    }));
  });

  it.each([
    { ...installation, suspended_at: "2026-11-09T00:00:00Z" },
    { ...installation, permissions: { metadata: "read" } },
  ])("deactivates suspended or contents-revoked installations without reactivating repositories", async (item) => {
    await saveAndSyncInstallation("user-a", item, "user-token");
    expect(mocks.json).not.toHaveBeenCalled();
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { userId: "user-a", installationId: "db-installation" }, data: { active: false } });
  });

  it("removes repositories without explicit read permission", async () => {
    mocks.json.mockResolvedValue({ total_count: 1, repositories: [{ ...repository, permissions: { pull: false } }] });
    await saveAndSyncInstallation("user-a", installation, "user-token");
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { userId: "user-a", installationId: "db-installation" }, data: { active: false } });
  });

  it("reads all repository pages before updating any connections", async () => {
    mocks.json.mockResolvedValueOnce({ total_count: 101, repositories: Array.from({ length: 100 }, (_, index) => ({ ...repository, id: index + 1 })) })
      .mockResolvedValueOnce({ total_count: 101, repositories: [{ ...repository, id: 101 }] });
    const result = await listAccessibleRepositories("7", "user-token");
    expect(result).toHaveLength(101);
    expect(mocks.json).toHaveBeenLastCalledWith("/user/installations/7/repositories?per_page=100&page=2", "user-token", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each([
    { total_count: 101, installations: [installation] },
    { total_count: 1001, installations: [installation] },
    { installations: [installation] },
    { total_count: 2, installations: [installation, installation] },
  ])("rejects incomplete/invalid installation snapshots without reconciling them", async (payload) => {
    mocks.json.mockResolvedValue(payload);
    await expect(syncAllUserInstallations("user-a")).rejects.toThrow();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.installation).not.toHaveBeenCalled();
  });

  it("does not write a partially retrieved repository snapshot", async () => {
    mocks.json.mockResolvedValueOnce({ total_count: 101, repositories: Array.from({ length: 100 }, (_, index) => ({ ...repository, id: index + 1 })) })
      .mockRejectedValueOnce(new Error("rate limited"));
    await expect(saveAndSyncInstallation("user-a", installation, "user-token")).rejects.toThrow();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.installation).not.toHaveBeenCalled();
  });

  it("rejects a second-page snapshot whose total changed", async () => {
    mocks.json.mockResolvedValueOnce({ total_count: 101, repositories: Array.from({ length: 100 }, (_, index) => ({ ...repository, id: index + 1 })) })
      .mockResolvedValueOnce({ total_count: 102, repositories: [{ ...repository, id: 101 }, { ...repository, id: 102 }] });
    await expect(listAccessibleRepositories("7", "user-token")).rejects.toThrow();
  });

  it("uses the requested user's token and rejects a removed installation", async () => {
    mocks.json.mockResolvedValue({ total_count: 0, installations: [] });
    await expect(findAccessibleInstallation("user-a", "7")).rejects.toThrow(/installation/);
    expect(mocks.token).toHaveBeenCalledWith("user-a");
  });
});
