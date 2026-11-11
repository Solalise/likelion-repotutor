import * as sqlite from "node:sqlite";
import { HttpError } from "../http.ts";

// The workspace's Node 22 types predate the authorizer shipped in Node 24.10.
export type SearchConnection = sqlite.DatabaseSync & {
  setAuthorizer(callback: (action: number, table: string | null, column: string | null, database: string | null) => number): void;
  enableDefensive(enabled: boolean): void;
};
const codes = (sqlite as unknown as { constants: Record<string, number> }).constants;
const columns = new Set(["id", "title", "body", "visibility"]);

/** Seed first, then permanently restrict this connection to one simple search SELECT. */
export function restrictSearchConnection(db: SearchConnection) {
  db.enableDefensive(true);
  db.exec("PRAGMA temp_store=MEMORY; PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;");
  let selects = 0;
  db.setAuthorizer((action, table, column, database) => {
    if (action === codes.SQLITE_SELECT) return ++selects === 1 ? codes.SQLITE_OK : codes.SQLITE_DENY;
    if (action === codes.SQLITE_READ && database === "main" && table === "search_posts" && columns.has(column ?? "")) return codes.SQLITE_OK;
    if (action === codes.SQLITE_FUNCTION && column?.toLowerCase() === "like") return codes.SQLITE_OK;
    return codes.SQLITE_DENY;
  });
  return () => { selects = 0; };
}

export function createSearchDatabase() {
  const db = new sqlite.DatabaseSync(":memory:", { allowExtension: false }) as SearchConnection;
  try {
    db.exec(`CREATE TABLE search_posts (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private'))
    );`);
    const insert = db.prepare("INSERT INTO search_posts VALUES (?, ?, ?, ?)");
    for (const row of [
      [1001, "동네 산책 안내", "주말 공개 산책 모임의 가상 안내입니다.", "public"],
      [1002, "책 나눔 소식", "공개 책 나눔 행사입니다.", "public"],
      [1003, "비공개 산책 메모", "SQLI 전용 가상 비공개 기록입니다. 실제 개인정보가 아닙니다.", "private"],
      [1004, "개인 연습 기록", "SQLI 전용 가상 비공개 연습 데이터입니다.", "private"],
    ] as const) insert.run(...row);
    const beginQuery = restrictSearchConnection(db);
    return {
      search(query: string, vulnerable = false) {
        if (query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) throw new HttpError(400, "INVALID_SEARCH", "검색어는 제어문자 없이 200자 이하여야 합니다.");
        // No multi-statement exercises. The authorizer is the primary SQL boundary.
        if (vulnerable && query.includes(";")) throw new HttpError(400, "SEARCH_REJECTED", "실습은 단일 SELECT 검색 조건 변경만 허용합니다.");
        beginQuery();
        try {
          const prefix = "SELECT id, title, body, visibility FROM search_posts WHERE visibility = 'public' AND title LIKE ";
          // Deliberate local SQLi: do not copy this concatenation into normal code.
          const statement = db.prepare(vulnerable ? `${prefix}'%${query}%' ORDER BY id LIMIT 20` : `${prefix}? ESCAPE '!' ORDER BY id LIMIT 20`);
          // Binding a LIKE pattern may trigger SQLite's automatic re-prepare.
          beginQuery();
          const literalPattern = `%${query.replace(/[!%_]/g, value => `!${value}`)}%`;
          return vulnerable ? statement.all() : statement.all(literalPattern);
        } catch {
          throw new HttpError(400, "SEARCH_REJECTED", "검색 SQL 문법이 잘못됐거나 허용된 SELECT 범위를 벗어났습니다.");
        }
      },
      close() { db.close(); },
    };
  } catch (error) { db.close(); throw error; }
}
export type SearchDatabase = ReturnType<typeof createSearchDatabase>;
