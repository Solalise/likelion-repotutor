import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), update: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { userRepository: { updateMany: mocks.update } } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { removeService, restoreService } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => { throw new Error(path); });
  mocks.update.mockResolvedValue({ count: 1 });
});
function form() { const value = new FormData(); value.set("connectionId", "connection-a"); return value; }

it("rejects unauthenticated deletion without touching data", async () => {
  mocks.auth.mockResolvedValue(null);
  await expect(removeService(form())).rejects.toThrow("/login");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("soft deletes only the current user's connection and offers undo", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-a" } });
  await expect(removeService(form())).rejects.toThrow("/services?removed=connection-a");
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "connection-a", userId: "user-a", removedAt: null }, data: { removedAt: expect.any(Date) } });
  expect(mocks.revalidate).toHaveBeenCalledWith("/services");
});
it("does not report success for another user's or missing connection", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-a" } });
  mocks.update.mockResolvedValue({ count: 0 });
  await expect(removeService(form())).rejects.toThrow("삭제할 서비스를 찾을 수 없습니다");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("restores only a connection belonging to the current user", async () => {
  mocks.auth.mockResolvedValue({ user: { id: "user-a" } });
  await expect(restoreService(form())).rejects.toThrow("/services");
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "connection-a", userId: "user-a" }, data: { removedAt: null } });
});
