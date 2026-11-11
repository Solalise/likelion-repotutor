import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestPreview } from "./RequestPreview";

describe("preview-only project lab", () => {
  it("shows three planned requests and clearly states they have not been sent", () => {
    const html = renderToStaticMarkup(<RequestPreview authorized apiPath="/api/orders/{resourceId}" resourceA="101" resourceB="102" />);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain("GET /api/orders/101");
    expect(html.match(/GET \/api\/orders\/102/g)).toHaveLength(2);
    expect(html).toContain("요청을 전송하거나 응답을 생성하지 않습니다");
    expect(html).not.toContain("<button");
  });
  it("does not show a request plan for unauthorized selections or invalid paths", () => {
    for (const props of [{ authorized: false, apiPath: "/api/{resourceId}" }, { authorized: true, apiPath: "https://example.com/{resourceId}" }]) {
      const html = renderToStaticMarkup(<RequestPreview {...props} resourceA="101" resourceB="102" />);
      expect(html).not.toContain("<li>");
      expect(html).toContain("서로 다른 A/B 리소스 ID");
    }
  });
});
