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

/** Extract the real query-construction and parameter-binding lines for the SQLi lesson. */
export async function readSqliLessonCode() {
  const source = await readFile(new URL("./features/search.ts", import.meta.url), "utf8");
  const start = source.indexOf("          const prefix = ");
  const end = source.indexOf("\n        } catch {", start);
  if (start < 0 || end < 0) throw new Error("SQL Injection 학습 코드 발췌 실패");
  const snippet = source.slice(start, end);
  const line = source.slice(0, start).split("\n").length;
  return { file: "src/features/search.ts", line, snippet };
}
