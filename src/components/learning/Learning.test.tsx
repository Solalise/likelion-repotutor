import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { courses, steps } from "@/lib/learn/courses";
import { LearningCourse, LearningDashboard } from "./Learning";
const state = vi.hoisted(() => ({ step: 0, completed: [] as number[], submitted: false, answers: [null, null, null] as (number | null)[] }));
vi.mock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>();
    return { ...actual, useState: (initial: unknown) => {
            const pair = actual.useState(initial);
            if (pair[0] && typeof pair[0] === "object" && "version" in pair[0])
                return [{ ...pair[0], ...state }, pair[1]];
            return pair;
        } };
});
beforeEach(() => Object.assign(state, { step: 0, completed: [], submitted: false, answers: [null, null, null] }));
it("renders four dashboard links without the long lesson document", () => {
    const html = renderToStaticMarkup(<LearningDashboard />);
    for (const c of courses)
        expect(html).toContain(`href="/learn/${c.id}"`);
    expect(html).not.toContain(courses[0].concept[0]);
});
it("renders each of the 24 stage views independently with flow, code, and quiz panels", () => {
    for (const c of courses)
        for (let step = 0; step < 6; step++) {
            state.step = step;
            const html = renderToStaticMarkup(<LearningCourse course={c}/>);
            expect(html).toContain(steps[step]);
            expect(html).not.toContain(courses.find(other => other.id !== c.id)!.concept[0]);
            if (step === 1)
                expect(html).toContain(c.id === "xss" ? "브라우저가 HTML 파싱" : 'aria-label="정상 요청과 응답 흐름"');
            if (step === 3) {
                expect(html).toContain(c.id === "xss" ? "취약 코드" : "취약 지점");
                expect(html).toContain(c.id === "xss" ? "안전 코드 · HTML 텍스트 위치" : 'aria-label="안전 코드"');
            }
            if (step === 5)
                expect((html.match(/type="radio"/g) ?? [])).toHaveLength(9);
            else
                expect(html).not.toContain('type="radio"');
        }
});
it("shows explanations, a persisted score, and the correct practice destination after completion", () => {
    for (const c of courses) {
        Object.assign(state, { step: 5, completed: [0, 1, 2, 3, 4, 5], submitted: true, answers: c.quizzes.map(q => q.answer) });
        const html = renderToStaticMarkup(<LearningCourse course={c}/>);
        if (c.id === "xss") {
            // XSS has an existing connection gate. Completion alone must not bypass it.
            expect(html).toContain("실습 서버 연결 확인 중");
            expect(html).not.toContain(`href="${c.lab}"`);
            expect(html).toContain("연결 다시 확인");
        } else expect(html).toContain(`href="${c.lab}" target="_blank" rel="noopener noreferrer"`);
        expect(html).toContain("기초 학습 완료");
        for (const q of c.quizzes)
            expect(html).toContain(q.explanation);
        expect(html).toContain("별도 과정");
    }
});
