import { describe, expect, it, vi } from "vitest";
import { requestSavedRecord } from "./recordClient";
import { emptySecurityRecord } from "@/types/securityTestRecord";
const identity = { repositoryFullName: "org/repo", commitSha: "a".repeat(40), recordKey: "target-version-1", kind: "SQL_INJECTION" as const };
describe("record persistence acknowledgement", () => {
  it("requires a successful matching saved record", async () => {
    const saved = { ...identity, id: "saved", revision: 1, draft: emptySecurityRecord() };
    const fetcher = vi.fn().mockResolvedValue(Response.json(saved));
    expect(await requestSavedRecord("/api/results", { method: "POST" }, identity, fetcher)).toEqual(saved);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
  });
  it("does not turn missing schema, TLS/network errors or malformed success into a save", async () => {
    const missing = vi.fn().mockResolvedValue(Response.json({ code: "RESULTS_SCHEMA_UNAVAILABLE", message: "DB 마이그레이션 보류 · 저장되지 않았습니다." }, { status: 503 }));
    await expect(requestSavedRecord("/api/results", {}, identity, missing)).rejects.toThrow("저장되지 않았습니다");
    const network = vi.fn().mockRejectedValue(new Error("DB connection failed"));
    await expect(requestSavedRecord("/api/results", {}, identity, network)).rejects.toThrow("connection failed");
    for (const data of [{}, { ...identity, id: "other", revision: 1, draft: {}, commitSha: "b".repeat(40) }]) {
      await expect(requestSavedRecord("/api/results", {}, identity, vi.fn().mockResolvedValue(Response.json(data)))).rejects.toThrow("성공으로 처리하지 않습니다");
    }
  });
});
