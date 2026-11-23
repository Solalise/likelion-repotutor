import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { courses } from "@/lib/learn/courses";
import { XssGoal, XssLesson } from "./XssLesson";
import { parseProgress, emptyProgress } from "@/lib/learn/progress";

const course = courses.find(c => c.id === "xss")!;
it("renders teaching payloads as text without executable SVG or script elements", () => {
  for (let step = 0; step < 5; step++) {
    const html = renderToStaticMarkup(<XssLesson step={step} course={course}/>);
    expect(html).not.toMatch(/<(?:svg|script)\b/i);
    expect(html).toContain("&lt;");
  }
});
it("separates three HTTP examples and browser execution evidence", () => {
  const html = renderToStaticMarkup(<XssLesson step={2} course={course}/>);
  expect(html.match(/POST \/api\/lab\/xss HTTP\/1.1/g)).toHaveLength(3);
  expect(html).toContain("교육용 예시");
  expect(html).toContain("코드 실행 성공을 의미하지 않습니다");
  expect(html).toContain("실습 브라우저의 실행 감지 신호");
});
it("preserves visited and completed steps independently across reloads", () => {
  const saved = { ...emptyProgress(), step: 3, completed: [0, 1], visited: [0, 1, 2, 3, 3, 99] };
  const restored = parseProgress(JSON.stringify(saved));
  expect(restored.completed).toEqual([0, 1]);
  expect(restored.visited).toEqual([0, 1, 2, 3]);
  expect(restored.step).toBe(3);
});
it("provides a learning goal and takeaway for each of six steps", () => {
  for (let step = 0; step < 6; step++) {
    expect(renderToStaticMarkup(<XssGoal step={step}/>)).toContain("이번 단계에서 배울 것");
    expect(renderToStaticMarkup(<XssGoal step={step} summary/>)).toContain("지금 이해해야 할 것");
  }
});
