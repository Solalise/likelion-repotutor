import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PracticeDashboard, practiceTopics } from "./PracticeDashboard";

it("provides all four immediate practice links without learning state or scores", () => {
  // No browser storage or completed course is present during this render.
  const html = renderToStaticMarkup(<PracticeDashboard/>);
  expect(practiceTopics).toHaveLength(4);
  for (const topic of practiceTopics) {
    for (const mode of ["guided", "free"]) {
      const url = new URL(topic.url);
      url.searchParams.set("mode", mode);
      expect(html).toContain(`href="${url.href.replaceAll("&", "&amp;")}" target="_blank" rel="noopener noreferrer"`);
    }
    expect(html).toContain(`href="/learn/${topic.id}"`);
    expect(html).toContain(topic.goal);
  }
  expect((html.match(/aria-label="[^"]+ 가이드 실습 \(새 탭\)"/g) ?? [])).toHaveLength(4);
  expect((html.match(/aria-label="[^"]+ 자유 실습 \(새 탭\)"/g) ?? [])).toHaveLength(4);
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
  expect(html).toContain("가이드 실습: 웹사이트에서 미션을 수행하고 실제 결과로 진행합니다.");
  expect(html).toContain("자유 실습: 같은 웹사이트를 직접 탐색하고 필요할 때만 힌트를 확인합니다.");
});
