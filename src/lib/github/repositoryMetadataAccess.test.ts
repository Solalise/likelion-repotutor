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

import ServicesPage from "@/app/services/page";
import RepositoriesPage from "@/app/repositories/page";
import { GET } from "@/app/api/github/repositories/route";
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); }, usePathname: () => "/services" }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue("user-a");
  mocks.auth.mockResolvedValue({ user: { id: "user-a", name: "Learner" } });
  mocks.records.mockResolvedValue([]); mocks.repositories.mockResolvedValue([]); mocks.installations.mockResolvedValue([]);
});

it("does not expose persisted repository metadata when GitHub cannot confirm permissions", async () => {
  mocks.sync.mockRejectedValue(new Error("offline"));
  expect((await GET()).status).toBe(503);
  // The old repository page now redirects; authorization belongs to /services and the list API.
  await ServicesPage({ searchParams: Promise.resolve({}) });
  expect(() => RepositoriesPage()).toThrow("/services");
  expect(mocks.records).not.toHaveBeenCalled();
  expect(mocks.repositories).not.toHaveBeenCalled();
  expect(mocks.installations).not.toHaveBeenCalled();
});

it("scopes the replacement service page and its analysis history to the current user", async () => {
  await ServicesPage({ searchParams: Promise.resolve({}) });
  expect(mocks.sync).toHaveBeenCalledWith("user-a");
  expect(mocks.repositories).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-a", active: true },
    include: expect.objectContaining({ repository: { select: expect.objectContaining({ analysisRuns: expect.objectContaining({
      where: { requestedByUserId: "user-a", source: "CONNECTED_REPOSITORY" },
    }) }) } }),
  }));
  // The public dashboard no longer queries old learning metadata; /services must not leak it either.
  expect(mocks.records).not.toHaveBeenCalled();
});

it("syncs permissions before serving repository lists for the requesting user", async () => {
  expect((await GET()).status).toBe(200);
  expect(() => RepositoriesPage()).toThrow("/services");
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(mocks.repositories).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-a", active: true } }));
});
