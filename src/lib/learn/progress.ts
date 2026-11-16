export const PROGRESS_VERSION = 1;
export type Progress = {
    version: number;
    step: number;
    completed: number[];
    answers: (number | null)[];
    submitted: boolean;
};
export function emptyProgress(): Progress { return { version: PROGRESS_VERSION, step: 0, completed: [], answers: [null, null, null], submitted: false }; }
export function progressKey(id: string) { return `vulnlab:learn:${id}`; }
export function parseProgress(raw: string | null): Progress {
    try {
        const p = JSON.parse(raw ?? "null");
        if (!p || p.version !== PROGRESS_VERSION || !Number.isInteger(p.step) || p.step < 0 || p.step > 5 || !Array.isArray(p.completed) || !Array.isArray(p.answers) || p.answers.length !== 3 || typeof p.submitted !== "boolean")
            return emptyProgress();
        const answers = p.answers.map((a: unknown) => Number.isInteger(a) && Number(a) >= 0 && Number(a) < 3 ? a as number : null);
        const submitted = p.submitted && answers.every((a: number | null) => a !== null);
        return { version: PROGRESS_VERSION, step: p.step, completed: [...new Set<number>(p.completed.filter((s: unknown) => Number.isInteger(s) && Number(s) >= 0 && Number(s) <= (submitted ? 5 : 4)))], answers, submitted };
    }
    catch {
        return emptyProgress();
    }
}
