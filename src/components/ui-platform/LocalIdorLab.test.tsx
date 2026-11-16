import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DashboardUI, LearningUI, PracticeUI } from "./PlatformViews";

it("links the main dashboard to both local training entries", () => {
  const html = renderToStaticMarkup(<DashboardUI />);
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=idor" target="_blank" rel="noopener noreferrer"');
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=sqli" target="_blank" rel="noopener noreferrer"');
});
it("opens IDOR and SQLi safely in new tabs and shows independent activation status", () => {
  const html = renderToStaticMarkup(<PracticeUI />);
  expect(html).toContain('id="local-lab-status"');
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=idor" target="_blank" rel="noopener noreferrer"');
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=sqli" target="_blank" rel="noopener noreferrer"');
  expect(html).toContain("SQL Injection 바로 실습하기");
  expect(html).toContain("XSS");
  expect(html).toContain("권한 검증");
  expect(html).toContain("http://127.0.0.1:4400/lab/xss");
  expect(html).toContain("로컬 전용");
  expect(html).toContain("다른 사용자에게 자동 제공");
  expect(html).toContain('role="status"');
  expect(html).toContain("BASIC_SITE_ENABLE_IDOR");
  expect(html).toContain("BASIC_SITE_ENABLE_SQLI");
  expect(html).toContain("npm.cmd --prefix labs/basic-site start");
});
it("adds a SQL Injection learning start button on /learn", () => {
  const html = renderToStaticMarkup(<LearningUI />);
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=sqli" target="_blank" rel="noopener noreferrer"');
  expect(html).toContain("SQL Injection 실습 시작 (새 탭)");
  expect(html).toContain('id="local-lab-status"');
});
