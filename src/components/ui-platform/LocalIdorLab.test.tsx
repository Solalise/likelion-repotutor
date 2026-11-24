import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DashboardUI, LearningUI, PracticeUI } from "./PlatformViews";
import { practiceTopics } from "./PracticeDashboard";

it("links the main dashboard to both local training entries", () => {
  const html = renderToStaticMarkup(<DashboardUI />);
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=idor&amp;mode=guided" target="_blank" rel="noopener noreferrer"');
  expect(html).toContain('href="http://127.0.0.1:4400/?lab=sqli&amp;mode=guided" target="_blank" rel="noopener noreferrer"');
});
it("opens all four guided/free labs safely in new tabs and shows independent activation status", () => {
  const html = renderToStaticMarkup(<PracticeUI />);
  expect(html).toContain('id="local-lab-status"');
  expect(practiceTopics.map(topic => topic.id)).toEqual(["idor", "sqli", "xss", "authz"]);
  for (const topic of practiceTopics) for (const mode of ["guided", "free"]) {
    const url = new URL(topic.url); url.searchParams.set("mode", mode);
    expect(html).toContain(`href="${url.href.replaceAll("&", "&amp;")}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain(`href="/learn/${topic.id}"`);
  }
  expect(html).toContain("가이드 실습"); expect(html).toContain("자유 실습");
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
