import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultDetail } from "./ResultDetail";
import { emptySecurityRecord } from "@/types/securityTestRecord";
describe("saved record detail", () => {
 it("shows persisted initial and retest observations without a server success verdict", () => {
  const target = { apiPath: "/api/orders", method: "GET", inputLocation: "query", parameter: "id" };
  const html = renderToStaticMarkup(createElement(ResultDetail, { record: { id: "saved", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), recordKey: "target-version-2", kind: "IDOR", revision: 1, updatedAt: "2026-11-19", draft: { ...emptySecurityRecord({ ...target, targetSnapshot: target }), view: "COMPARE", inspectionMethod: "initial-method", beforeObservation: "initial-observation", retestMethod: "retest-method", afterObservation: "retest-observation", changes: "ownership-check-added" } } }));
  for (const text of ["owner/repo", "target-version-2", "initial-method", "initial-observation", "retest-method", "retest-observation", "ownership-check-added", "서버 미검증", "수정 저장"]) expect(html).toContain(text);
  expect(html).not.toContain("검증 성공");
 });
});
