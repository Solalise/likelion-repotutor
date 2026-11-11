import http from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { HttpError, sendJson } from "./http.ts";
import { route } from "./routes.ts";
import { createStore } from "./store.ts";
import { readLessonCode } from "./lessonCode.ts";
import { createSearchDatabase } from "./features/search.ts";

export async function createBasicSite(options: { port?: number; enableIdorLab?: boolean; enableSqliLab?: boolean } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("기본 실습 서버는 로컬 개발 전용입니다. production 실행은 지원하지 않습니다.");
  const enableIdorLab = options.enableIdorLab ?? process.env.BASIC_SITE_ENABLE_IDOR === "1";
  const enableSqliLab = options.enableSqliLab ?? process.env.BASIC_SITE_ENABLE_SQLI === "1";
  if (enableSqliLab && !["development", "test"].includes(process.env.NODE_ENV ?? "")) {
    throw new Error("SQL Injection 실습은 명시적인 development/test 환경에서만 활성화할 수 있습니다.");
  }
  if (enableIdorLab && process.env.NODE_ENV !== undefined && !["development", "test"].includes(process.env.NODE_ENV)) {
    throw new Error("IDOR 실습은 로컬 development/test 환경에서만 활성화할 수 있습니다.");
  }
  const requestedPort = options.port ?? 4400;
  if (!Number.isInteger(requestedPort) || (requestedPort !== 0 && (requestedPort < 1024 || requestedPort > 65535))) throw new Error("포트는 1024~65535 정수여야 합니다.");
  const store = createStore();
  const assets = {
    script: await readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    style: await readFile(new URL("../public/site.css", import.meta.url), "utf8"),
    lab: await readFile(new URL("../public/lab.js", import.meta.url), "utf8"),
    httpClient: await readFile(new URL("../public/http-client.js", import.meta.url), "utf8"),
    lesson: await readFile(new URL("../public/lesson.js", import.meta.url), "utf8"),
    lessonCode: await readLessonCode(),
  };
  let port = requestedPort;
  const searchDb = createSearchDatabase();
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      // Loopback binding alone does not prevent DNS rebinding or cross-site POSTs.
      const host = request.headers.host;
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) throw new HttpError(403, "LOOPBACK_REQUIRED", "루프백 접근만 허용합니다.");
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "INVALID_HOST", "로컬 개발 주소로 접속해주세요.");
      if (request.method !== "GET" && request.headers.origin !== `http://${host}`) throw new HttpError(403, "INVALID_ORIGIN", "동일한 로컬 Origin에서만 요청할 수 있습니다.");
      await route(request, response, store, assets, enableIdorLab, searchDb, enableSqliLab);
    } catch (error) {
      if (response.headersSent || response.destroyed) { response.end(); return; }
      if (error instanceof HttpError) sendJson(response, error.status, { error: error.code, message: error.message });
      else sendJson(response, 500, { error: "INTERNAL_ERROR", message: "실습 서버 요청을 처리하지 못했습니다." });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 30;
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(requestedPort, "127.0.0.1", resolve); });
  } catch (error) { searchDb.close(); throw error; }
  port = (server.address() as import("node:net").AddressInfo).port;
  return {
    port, url: `http://127.0.0.1:${port}`, enableIdorLab, enableSqliLab,
    async close() {
      store.auth.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      searchDb.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = process.env.BASIC_SITE_PORT;
  if (value !== undefined && !/^\d{4,5}$/.test(value)) throw new Error("BASIC_SITE_PORT는 1024~65535 정수여야 합니다.");
  const site = await createBasicSite({ port: value === undefined ? 4400 : Number(value) });
  console.log(`SQL Injection 실습 ${site.enableSqliLab ? "활성화" : "비활성화"} · 검색 전용 메모리 SQLite · 일반 검색은 공개 글만 반환`);
  console.log(`VulnLab 기본 실습: ${site.url}\n로컬 개발 전용 · 가상 데이터 · IDOR 실습 ${site.enableIdorLab ? "활성화" : "비활성화"} · 재시작 시 초기화`);
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    if (closing) return;
    closing = true;
    void site.close().then(() => process.exit(0));
  });
}
