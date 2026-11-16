import { describe, expect, it } from "vitest";
import ts from "typescript";
import { courses, steps } from "./courses";
import { emptyProgress, parseProgress, progressKey } from "./progress";
describe("learning progress restoration", () => {
    it("isolates courses and restores visited step, completion and quiz results", () => {
        expect(new Set(courses.map(c => progressKey(c.id))).size).toBe(4);
        const saved = { version: 1, step: 5, completed: [0, 1, 2, 3, 4, 5], answers: [1, 2, 0], submitted: true };
        expect(parseProgress(JSON.stringify(saved))).toEqual(saved);
    });
    it("resets malformed and outdated data without throwing", () => {
        for (const value of [null, "broken", "{}", JSON.stringify({ ...emptyProgress(), version: 0 }), JSON.stringify({ ...emptyProgress(), step: 9 })]) {
            expect(parseProgress(value)).toEqual(emptyProgress());
        }
    });
    it("does not restore incomplete quiz submissions or invalid completion indices", () => {
        const result = parseProgress(JSON.stringify({ ...emptyProgress(), submitted: true, answers: [0, 99, null], completed: [0, 0, -1, 6, 5] }));
        expect(result.submitted).toBe(false);
        expect(result.completed).toEqual([0]);
        expect(result.answers).toEqual([0, null, null]);
    });
});
describe("course integrity", () => {
    it("provides four independent six-step courses and twelve explained quizzes", () => {
        expect(courses.map(c => c.id)).toEqual(["idor", "sqli", "xss", "authz"]);
        expect(steps).toHaveLength(6);
        for (const c of courses) {
            expect(c.flow).toHaveLength(4);
            expect(c.quizzes).toHaveLength(3);
            expect(c.concept.length).toBeGreaterThanOrEqual(3);
            expect(c.requests).toHaveLength(2);
            expect(c.lab).toMatch(/^http:\/\/127\.0\.0\.1:4400\//);
            for (const q of c.quizzes) {
                expect(q.options).toHaveLength(3);
                expect(q.options[q.answer]).toBeTruthy();
                expect(q.explanation.length).toBeGreaterThan(30);
            }
            for (const code of [c.bad, c.safe]) {
                const result = ts.transpileModule(`function example() {\n${code.join("\n")}\n}`, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
                expect(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
            }
            expect(c.danger.every(n => n > 0 && n <= c.bad.length)).toBe(true);
        }
    });
});
