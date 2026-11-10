import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), auth: vi.fn(), sync: vi.fn(), records: vi.fn(), repositories: vi.fn(), installations: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/currentUser", () => ({ requireUserId: mocks.user }));
vi.mock("./installations", () => ({ syncAllUserInstallations: mocks.sync }));
vi.mock("@/lib/db", () => ({ db: {
  learningRecord: { findMany: mocks.records }, userRepository: { findMany: mocks.repositories },
  gitHubInstallation: { findMany: mocks.installations },
} }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import DashboardPage from "@/app/dashboard/page";
import RepositoriesPage from "@/app/repositories/page";
import { GET } from "@/app/api/github/repositories/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue("user-a");
  mocks.auth.mockResolvedValue({ user: { id: "user-a", name: "Learner" } });
  mocks.records.mockResolvedValue([]); mocks.repositories.mockResolvedValue([]); mocks.installations.mockResolvedValue([]);
});

it("does not expose persisted repository metadata when GitHub cannot confirm permissions", async () => {
  mocks.sync.mockRejectedValue(new Error("offline"));
  expect((await GET()).status).toBe(503);
  await expect(DashboardPage()).rejects.toThrow();
  await expect(RepositoriesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  expect(mocks.records).not.toHaveBeenCalled();
  expect(mocks.repositories).not.toHaveBeenCalled();
  expect(mocks.installations).not.toHaveBeenCalled();
});

it("filters old learning metadata through currently active user-owned connections", async () => {
  await DashboardPage();
  expect(mocks.sync).toHaveBeenCalledWith("user-a");
  expect(mocks.records).toHaveBeenCalledWith(expect.objectContaining({ where: {
    userId: "user-a", repository: { users: { some: { userId: "user-a", active: true, installation: { suspendedAt: null } } } },
  } }));
});

it("syncs permissions before serving repository lists for the requesting user", async () => {
  expect((await GET()).status).toBe(200);
  await RepositoriesPage({ searchParams: Promise.resolve({}) });
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(mocks.repositories).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-a", active: true } }));
});
