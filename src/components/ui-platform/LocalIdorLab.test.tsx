import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DashboardUI, PracticeUI } from "./PlatformViews";

it("links the main dashboard to the local IDOR entry on practice", () => {
  expect(renderToStaticMarkup(<DashboardUI />)).toContain('href="/practice#local-idor"');
});
it("opens the existing independent lab safely in a new tab and explains local setup", () => {
  const html = renderToStaticMarkup(<PracticeUI />);
  expect(html).toContain('id="local-idor"');
  expect(html).toContain('href="http://127.0.0.1:4400/lab/idor" target="_blank" rel="noopener noreferrer"');
  expect(html).toContain("로컬 전용");
  expect(html).toContain("다른 사용자에게 자동 제공");
  expect(html).toContain('role="status"');
  expect(html).toContain("BASIC_SITE_ENABLE_IDOR");
  expect(html).toContain("npm.cmd --prefix labs/basic-site start");
});
