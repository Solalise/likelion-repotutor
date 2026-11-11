import { readFile } from "node:fs/promises";

/** Extract exact function declarations from the implementation served by this process. */
export async function readLessonCode() {
  const source = await readFile(new URL("./features/posts.ts", import.meta.url), "utf8");
  return Object.fromEntries(["getVulnerablePost", "getPost", "canReadPost"].map(name => {
    const start = source.indexOf(`export function ${name}(`);
    const end = source.indexOf("\n}", start);
    if (start < 0 || end < 0) throw new Error(`학습 코드 발췌 실패: ${name}`);
    return [name, source.slice(start, end + 2)];
  }));
}
