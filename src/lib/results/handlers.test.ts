import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySecurityRecord } from "@/types/securityTestRecord";
import { Prisma } from "@prisma/client";
import { manualAccessFixture, accessTestNow } from "@/lib/security-lab/manualAccess.fixtures";
const mocks = vi.hoisted(() => ({ user: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), analysis: vi.fn() }));
vi.mock("@/lib/auth/currentUser", () => ({ currentUserId: mocks.user }));
vi.mock("@/lib/db", () => ({ db: { securityTestRecord: { findFirst: mocks.findFirst, findMany: mocks.findMany, create: mocks.create, updateMany: mocks.updateMany }, analysisRun: { findFirst: mocks.analysis } } }));
import { handleResults } from "./handlers";
import { parseRecord } from "./validation";
const target = { apiPath: "/api/orders", method: "GET", inputLocation: "query", parameter: "id" };
const input = () => ({ repositoryFullName: "owner/repo", commitSha: "a".repeat(40), recordKey: '["scope","confirmed-target",1]', kind: "IDOR", draft: emptySecurityRecord({ ...target, targetSnapshot: target }) });
const request = (method = "POST", body: unknown = input()) => new Request("https://vulnlab.test/api/results", { method, headers: { origin: "https://vulnlab.test", "content-type": "application/json" }, ...(method !== "GET" ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(accessTestNow)); mocks.user.mockResolvedValue("user-1"); mocks.analysis.mockResolvedValue({ id: "analysis-1" }); });
afterEach(() => vi.useRealTimers());
describe("persistent manual records", () => {
 it("keeps static candidate metadata as manual provenance and preserves its analysis/target binding", async () => {
  const f=manualAccessFixture(), details={...f.target.details,"정적 후보 ID":"idor:access-control-static-v1:example","정적 코드 위치":"app/api/items/route.ts:8–9","정적 분석 출처":"STATIC_REVIEW_ONLY · 실행 미검증"};
  const target={...f.target,details};
  const body={...f.binding,kind:"IDOR",draft:emptySecurityRecord({apiPath:target.apiPath,method:target.method,codeLocation:details["정적 코드 위치"],targetSnapshot:target})};
  mocks.create.mockResolvedValue({id:"linked"});
  expect((await handleResults(request("POST",body))).status).toBe(201);
  expect(mocks.create.mock.calls[0][0].data).toMatchObject({source:"MANUAL",userId:"user-1",analysisRunId:"analysis-1",commitSha:f.binding.commitSha,draft:{status:"NOT_RUN",targetSnapshot:{details}}});
 });
 it.each(["IDOR", "AUTHORIZATION"] as const)("stores %s comparisons only as owned manual records", async kind => {
  const f = manualAccessFixture(kind), body = { repositoryFullName: f.binding.repositoryFullName, commitSha: f.binding.commitSha, recordKey: f.binding.recordKey, kind, draft: { ...emptySecurityRecord({ apiPath: f.target.apiPath, method: f.target.method, targetSnapshot: f.target }), accessComparison: f.comparison } };
  mocks.create.mockResolvedValue({ id: "saved" }); expect((await handleResults(request("POST", body))).status).toBe(201);
  expect(mocks.create.mock.calls[0][0].data).toMatchObject({ source: "MANUAL", userId: "user-1", draft: { status: "NOT_RUN", accessComparison: f.comparison } });
  mocks.findFirst.mockResolvedValue(null); expect((await handleResults(request("GET"), "foreign")).status).toBe(404); expect((await handleResults(request("PATCH", { ...body, revision: 1 }), "foreign")).status).toBe(404);
  expect(mocks.updateMany).not.toHaveBeenCalled();
 });
 it("blocks credentials, forged verification, stale comparison targets and altered access policy on update", async () => {
  const f = manualAccessFixture(), body = { ...f.binding, kind: "IDOR", draft: { ...emptySecurityRecord({ apiPath: f.target.apiPath, method: f.target.method, targetSnapshot: f.target }), accessComparison: f.comparison } };
  for (const draft of [{ ...body.draft, memo: "Cookie: fixture=secret" }, { ...body.draft, accessComparison: { ...f.comparison, serverVerified: true } }, { ...body.draft, accessComparison: { ...f.comparison, targetIdentity: "previous-version" } }]) expect((await handleResults(request("POST", { ...body, draft }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.findFirst.mockResolvedValue({ ...parseRecord(body), targetIdentity: "old-policy-version" });
  expect((await handleResults(request("PATCH", { ...body, revision: 1 }), "owned")).status).toBe(409); expect(mocks.updateMany).not.toHaveBeenCalled();
 });
 it("returns explicit unavailable-schema guidance without pretending to save", async () => {
  mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("table missing", { code: "P2021", clientVersion: "test" }));
  const response = await handleResults(request()); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "RESULTS_SCHEMA_UNAVAILABLE", message: expect.stringContaining("저장되지 않았습니다") });
 });
 it("reports DB connection failures safely", async () => {
  mocks.analysis.mockRejectedValue(new Error("sensitive connection details"));
  const response = await handleResults(request()); expect(response.status).toBe(503);
  const data = await response.json(); expect(data.code).toBe("RESULTS_UNAVAILABLE"); expect(JSON.stringify(data)).not.toContain("sensitive");
 });
 it("requires authentication", async () => { mocks.user.mockResolvedValue(undefined); expect((await handleResults(request())).status).toBe(401); expect(mocks.create).not.toHaveBeenCalled(); });
 it("creates only manual provenance from an owned completed analysis", async () => { mocks.create.mockResolvedValue({ id: "record-1" }); expect((await handleResults(request("POST", { ...input(), source: "SERVER" }))).status).toBe(201); expect(mocks.analysis).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ requestedByUserId: "user-1", status: "COMPLETED", commitSha: "a".repeat(40) }) })); expect(mocks.create.mock.calls[0][0].data).toMatchObject({ userId: "user-1", source: "MANUAL", analysisRunId: "analysis-1" }); });
 it("rejects an unowned or missing analysis", async () => { mocks.analysis.mockResolvedValue(null); expect((await handleResults(request())).status).toBe(403); });
 it("scopes list and filters to the current user", async () => { mocks.findMany.mockResolvedValue([]); await handleResults(new Request("https://vulnlab.test/api/results?kind=IDOR&status=OBSERVED&repository=owner/repo")); expect(mocks.findMany.mock.calls[0][0].where).toEqual({ userId: "user-1", kind: "IDOR", status: "OBSERVED", repositoryFullName: "owner/repo" }); });
 it("hides foreign records on read and update", async () => { mocks.findFirst.mockResolvedValue(null); expect((await handleResults(request("GET"), "foreign")).status).toBe(404); expect((await handleResults(request("PATCH"), "foreign")).status).toBe(404); expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", userId: "user-1" } }); expect(mocks.updateMany).not.toHaveBeenCalled(); });
 it("prevents target/version reuse", async () => { mocks.findFirst.mockResolvedValue({ ...parseRecord(input()), commitSha: "b".repeat(40) }); expect((await handleResults(request("PATCH", { ...input(), revision: 1 }), "record")).status).toBe(409); });
 it("updates owned records with optimistic revision check", async () => { mocks.findFirst.mockResolvedValue(parseRecord(input())); mocks.updateMany.mockResolvedValue({ count: 1 }); expect((await handleResults(request("PATCH", { ...input(), revision: 2 }), "record")).status).toBe(200); expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: "record", userId: "user-1", revision: 2 }); });
 it("detects concurrent edits", async () => { mocks.findFirst.mockResolvedValue(parseRecord(input())); mocks.updateMany.mockResolvedValue({ count: 0 }); expect((await handleResults(request("PATCH", { ...input(), revision: 1 }), "record")).status).toBe(409); });
 it("rejects cross-origin writes", async () => { const r = request(); r.headers.set("origin", "https://evil.test"); expect((await handleResults(r)).status).toBe(403); });
 it("validates enums, lengths, target consistency and retest completion", () => { for (const draft of [{ status: "VERIFIED" }, { memo: "x".repeat(4001) }, { apiPath: "/different" }, { retestStatus: "RECORDED" }]) expect(() => parseRecord({ ...input(), draft: { ...input().draft, ...draft } })).toThrow(); });
});
