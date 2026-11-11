import { describe, expect, it } from "vitest";
import { GET as vulnerable } from "@/app/api/security-lab/vulnerable/orders/route";
import { GET as fixed } from "@/app/api/security-lab/fixed/orders/route";

describe("isolated IDOR HTTP handlers", () => {
  for (const [name, handler] of [["vulnerable", vulnerable], ["fixed", fixed]] as const) {
    it(`${name}: A can read 101 and responses are not cached`, async () => {
      const response = handler(new Request("http://localhost/api/security-lab/orders?orderId=101"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ currentUser: "A", order: { id: 101, ownerId: "A" } });
    });
    it(`${name}: rejects invalid IDs and unexpected parameters`, () => {
      for (const query of ["orderId=https://example.com", "orderId=101&url=https://example.com", "orderId=101&orderId=102", "orderId=101&userId=B", "", "orderId=__proto__"]) {
        expect(handler(new Request(`http://localhost/api/security-lab/orders?${query}`)).status).toBe(400);
      }
      expect(handler(new Request("http://localhost/api/security-lab/orders?orderId=999")).status).toBe(404);
    });
  }
  it("exposes B only through the deliberately vulnerable endpoint", async () => {
    const request = new Request("http://localhost/api/security-lab/orders?orderId=102", { headers: { "x-user-id": "B", cookie: "userId=B" } });
    expect(await vulnerable(request).json()).toMatchObject({ currentUser: "A", order: { id: 102, ownerId: "B" } });
    const denied = fixed(request);
    expect(denied.status).toBe(403);
    const body = await denied.json();
    expect(body.error).toBe("FORBIDDEN");
    expect(body).not.toHaveProperty("order");
    expect(JSON.stringify(body)).not.toContain("크림 머그");
  });
});
