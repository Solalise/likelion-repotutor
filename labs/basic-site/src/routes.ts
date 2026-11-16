import { extraLabPage, xssDocument } from "./extraLabs.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getPost, getVulnerablePost, listPosts } from "./features/posts.ts";
import { HttpError, readJson, sendJson } from "./http.ts";
import { page } from "./pages.ts";
import type { Store } from "./store.ts";
import type { SearchDatabase } from "./features/search.ts";
import { selectedGuide } from "./guide.ts";

export type Assets = { practice: string; extra: string; script: string; style: string; lab: string; httpClient: string; lesson: string; sqliLesson: string; lessonCode: Record<string, string>; sqliCode: { file: string; line: number; snippet: string } };
export async function route(request: IncomingMessage, response: ServerResponse, store: Store, assets: Assets, enableIdorLab = false, searchDb?: SearchDatabase, enableSqliLab = false, enableXssLab = false, enableAuthzLab = false) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const user = store.auth.current(request.headers.cookie);
  if (request.method === "GET") {
    if (path === "/assets/practice.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(assets.practice); return;
    }
    if (path === "/assets/extra-labs.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); response.end(assets.extra); return;
    }
    if (path === "/lab/xss" || path === "/lab/authz") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(extraLabPage(path.endsWith("xss") ? "xss" : "authz", path.endsWith("xss") ? enableXssLab : enableAuthzLab)); return;
    }
    if (path === "/api/lab/authz" && enableAuthzLab) {
      if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "로그인 후 실습하세요.");
      const mode = url.searchParams.get("mode");
      if (!["safe", "vulnerable"].includes(mode ?? "")) throw new HttpError(400, "INVALID_MODE", "실습 모드를 선택하세요.");
      if (mode === "safe" && user.role !== "admin") throw new HttpError(403, "FORBIDDEN", "서버가 관리자 역할을 확인하여 접근을 거부했습니다.");
      sendJson(response, 200, { user, report: "관리자 전용 가상 통계: 실습 회원 3명", mode }); return;
    }
    if (path === "/api/search" || (path === "/api/lab/vulnerable/search" && enableSqliLab)) {
      if (path === "/api/lab/vulnerable/search" && !user) throw new HttpError(401, "LOGIN_REQUIRED", "실습 검색은 로그인 후 사용할 수 있습니다.");
      if (!searchDb) throw new HttpError(503, "SEARCH_UNAVAILABLE", "검색을 사용할 수 없습니다.");
      if (url.searchParams.getAll("q").length !== 1 || [...url.searchParams.keys()].some(key => key !== "q")) throw new HttpError(400, "INVALID_SEARCH", "q 검색어 하나만 전달해주세요.");
      sendJson(response, 200, { posts: searchDb.search(url.searchParams.get("q")!, path !== "/api/search"), dataset: "sqli-practice" }); return;
    }
    if (path === "/assets/lesson.js" || path === "/assets/sqli-lesson.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(path === "/assets/lesson.js" ? assets.lesson : assets.sqliLesson); return;
    }
    if (path === "/api/lab/idor-code" && enableIdorLab) {
      if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "로그인 후 코드를 확인하세요.");
      sendJson(response, 200, { file: "src/features/posts.ts", snippets: assets.lessonCode }); return;
    }
    if (path === "/api/lab/sqli-code" && enableSqliLab) {
      if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "로그인 후 코드를 확인하세요.");
      sendJson(response, 200, assets.sqliCode); return;
    }
    // Only this public, credential-free status endpoint is readable cross-origin.
    if (path === "/api/health") {
      response.setHeader("Access-Control-Allow-Origin", "*");
      sendJson(response, 200, { service: "vulnlab-basic-site", idorEnabled: enableIdorLab, sqliEnabled: enableSqliLab, xssEnabled: enableXssLab, authzEnabled: enableAuthzLab }); return;
    }
    if (path === "/assets/lab.js" || path === "/assets/http-client.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(path.endsWith("lab.js") ? assets.lab : assets.httpClient); return;
    }
    if (path === "/assets/app.js" || path === "/assets/site.css") {
      response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8" });
      response.end(path.endsWith(".js") ? assets.script : assets.style); return;
    }
    if (path === "/api/me") {
      if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
      sendJson(response, 200, { user }); return;
    }
    if (path === "/api/posts") { sendJson(response, 200, { posts: listPosts(store, user) }); return; }
    const apiPost = /^\/api\/posts\/(\d{1,12})$/.exec(path);
    if (apiPost) { sendJson(response, 200, { post: getPost(store, user, Number(apiPost[1])) }); return; }
    const labPost = /^\/api\/lab\/vulnerable\/posts\/(\d{1,12})$/.exec(path);
    if (labPost && enableIdorLab) { sendJson(response, 200, { post: getVulnerablePost(store, user, Number(labPost[1])) }); return; }
    const postPage = /^\/posts\/(\d{1,12})$/.exec(path);
    if (["/", "/posts", "/login", "/lab/idor"].includes(path) || postPage) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page(path === "/lab/idor" ? "lab" : path === "/login" ? "login" : postPage ? "post" : "posts", user, postPage ? Number(postPage[1]) : undefined, enableIdorLab, selectedGuide(url.searchParams))); return;
    }
  }
  if (request.method === "POST" && path === "/api/lab/xss" && enableXssLab) {
    if (!user) throw new HttpError(401, "LOGIN_REQUIRED", "로그인 후 실습하세요.");
    const input = await readJson(request);
    if (typeof input.text !== "string" || input.text.length > 2000 || !["safe", "vulnerable"].includes(String(input.mode))) throw new HttpError(400, "INVALID_INPUT", "출력은 2000자 이하, 모드는 safe/vulnerable이어야 합니다.");
    sendJson(response, 200, { document: xssDocument(input.text, input.mode === "vulnerable"), mode: input.mode }); return;
  }
  if (request.method === "POST" && path === "/api/auth/login") {
    if (!store.auth.allowLoginAttempt()) throw new HttpError(429, "LOGIN_RATE_LIMIT", "로그인 시도 제한입니다. 1분 후 다시 시도해주세요.");
    const input = await readJson(request);
    if (Object.keys(input).some(key => !["userId", "password"].includes(key)) || typeof input.userId !== "string" || typeof input.password !== "string" || input.userId.length > 80 || input.password.length > 128) {
      throw new HttpError(400, "INVALID_CREDENTIALS", "아이디와 비밀번호 형식을 확인해주세요.");
    }
    const authenticated = store.auth.authenticate(input.userId, input.password);
    if (!authenticated) throw new HttpError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
    response.setHeader("Set-Cookie", store.auth.login(authenticated, request.headers.cookie));
    sendJson(response, 200, { user: authenticated }); return;
  }
  if (request.method === "POST" && path === "/api/auth/logout") {
    await readJson(request);
    store.auth.logout(request.headers.cookie);
    response.setHeader("Set-Cookie", store.auth.clearCookie);
    sendJson(response, 200, { ok: true }); return;
  }
  if (!["GET", "POST"].includes(request.method ?? "")) throw new HttpError(405, "METHOD_NOT_ALLOWED", "지원하지 않는 메서드입니다.");
  throw new HttpError(404, "NOT_FOUND", "페이지 또는 API를 찾을 수 없습니다.");
}
