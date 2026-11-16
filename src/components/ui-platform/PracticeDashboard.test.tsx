import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PracticeDashboard, practiceTopics } from "./PracticeDashboard";

it("provides all four immediate practice links without learning state or scores", () => {
  // No browser storage or completed course is present during this render.
  const html = renderToStaticMarkup(<PracticeDashboard/>);
  expect(practiceTopics).toHaveLength(4);
  for (const topic of practiceTopics) {
    expect(html).toContain(`href="${topic.url}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain(`href="/learn/${topic.id}"`);
    expect(html).toContain(topic.goal);
  }
  expect((html.match(/aria-label="[^"]+ 바로 실습하기 \(새 탭\)"/g) ?? [])).toHaveLength(4);
  expect((html.match(/난이도 ·/g) ?? [])).toHaveLength(4);
  expect(html).toContain("학습·퀴즈 선행 조건 없음");
  expect(html).not.toContain("aria-disabled");
});

it("keeps server instructions, reconnect action and optional guide explanation available", () => {
  const html = renderToStaticMarkup(<PracticeDashboard/>);
  expect(html).toContain('id="local-lab-status"');
  for (const flag of ["IDOR", "SQLI", "XSS", "AUTHZ"]) expect(html).toContain(`BASIC_SITE_ENABLE_${flag}`);
  expect(html).toContain("npm.cmd --prefix labs/basic-site start");
  expect(html).toContain("상태 다시 확인");
  expect(html).toContain("실습 링크는 새 탭에서 직접 확인");
  expect(html).toContain("가이드는 선택 사항");
});
