import { describe, expect, it } from "vitest";
import { createRequestPreview, projectSelectionUrl, validConnectionId, validateApiPath, validateResourceId } from "./projectPlan";

describe("GET-only IDOR request planning", () => {
  it.each(["/api/orders/{resourceId}", "/api/orders?orderId={resourceId}", "/api/users/{resourceId}/orders?view=summary"])('accepts relative template %s', (path) => {
    expect(validateApiPath(path)).toBeUndefined();
  });
  it.each([
    "", "https://example.com/{resourceId}", "//example.com/{resourceId}", "http://localhost:3000/{resourceId}",
    "/api/../{resourceId}", "/api/./{resourceId}", "/api/%2e%2e/{resourceId}", "/api/%252f/{resourceId}",
    "/api\\orders/{resourceId}", "/api/orders/{resourceId}#secret", "/api/orders/{resourceId}\n",
    "/api/orders/101", "/api/{resourceId}/{resourceId}", "/api/{resourceId}?url=https://example.com",
    "/api/{resourceId}?token=", "/api/{otherId}", "/api/{resourceId}??id=2",
  ])('rejects unsafe or unsupported template %s', (path) => {
    expect(validateApiPath(path)).toBeTypeOf("string");
    expect(createRequestPreview(path, "101", "102")).toEqual([]);
  });
  it("rejects path injection and identical resources instead of producing a misleading plan", () => {
    for (const id of ["", "../102", "a/b", "a?b", "a#b", "%2f", "a".repeat(81)]) expect(validateResourceId(id)).toBeTypeOf("string");
    expect(validateResourceId("test_123-abc")).toBeUndefined();
    expect(createRequestPreview("/api/{resourceId}", "101", "101")).toEqual([]);
  });
  it("previews both baselines and the cross-owner request without executing HTTP", () => {
    expect(createRequestPreview("/api/orders?orderId={resourceId}", "101", "102")).toEqual([
      { account: "A", owner: "A", purpose: "A의 정상 접근 확인", path: "/api/orders?orderId=101" },
      { account: "B", owner: "B", purpose: "B의 데이터와 소유권 확인", path: "/api/orders?orderId=102" },
      { account: "A", owner: "B", purpose: "다른 사용자 데이터 접근 여부 확인", path: "/api/orders?orderId=102" },
    ]);
  });
  it("round-trips the selection in the URL for reload and rejects malformed IDs", () => {
    const url = new URL(projectSelectionUrl("connection-a"), "http://localhost");
    expect(url.pathname).toBe("/security-lab/project");
    expect(url.searchParams.get("connectionId")).toBe("connection-a");
    expect(validConnectionId(url.searchParams.get("connectionId")!)).toBe(true);
    for (const id of ["", "../a", "https://example.com", "a&user=b"]) expect(validConnectionId(id)).toBe(false);
    expect(projectSelectionUrl("")).toBe("/security-lab/project");
  });
});
