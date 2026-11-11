import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { createBasicSite } from "../src/server.ts";
import { createAuth, passwordRecord } from "../src/auth.ts";
import { escapeHtml } from "../src/pages.ts";
import type { Post, User } from "../src/types.ts";
import { readFile } from "node:fs/promises";
import { readLessonCode } from "../src/lessonCode.ts";
// @ts-expect-error Browser module shared with real HTTP tests.
import { questions, gradeQuiz, learningComplete, isNormalComparison, analyzeDiscovery } from "../public/lesson.js";
// @ts-expect-error Browser ES module is shared with these real HTTP tests without a build step.
import { postPath, requestPost, isOwnBaseline, isIdorDiscovery } from "../public/http-client.js";

type TestBody = { user: User; posts: Omit<Post, "body">[]; post: Post; error: string; message: string };
async function bodyOf(response: Response) {
  const body = await response.json();
  assert.ok(body && typeof body === "object" && !Array.isArray(body));
  return body as TestBody;
}

let site: Awaited<ReturnType<typeof createBasicSite>>;
before(async () => { site = await createBasicSite({ port: 0, enableIdorLab: true }); });
after(async () => { await site?.close(); });
async function login(userId: string, password: string, cookie?: string) {
  const response = await fetch(`${site.url}/api/auth/login`, {
    method: "POST", headers: { Origin: site.url, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ userId, password }),
  });
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function json(path: string, cookie?: string) {
  const response = await fetch(site.url + path, { headers: cookie ? { Cookie: cookie } : {} });
  return { response, body: await bodyOf(response) };
}

test("public health identifies the lab and exposes only status cross-origin", async () => {
  const response = await fetch(`${site.url}/api/health`, { headers: { Origin: "http://localhost:3000" } });
  assert.deepEqual(await response.json(), { service: "vulnlab-basic-site", idorEnabled: true });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const path of ["/api/posts", "/api/me", "/api/lab/vulnerable/posts/102"]) {
    assert.equal((await fetch(site.url + path)).headers.get("access-control-allow-origin"), null);
  }
  const disabled = await createBasicSite({ port: 0, enableIdorLab: false });
  try {
    assert.deepEqual(await (await fetch(`${disabled.url}/api/health`)).json(), { service: "vulnlab-basic-site", idorEnabled: false });
  } finally { await disabled.close(); }
});

test("pages and assets are served locally with actual browser API requests", async () => {
  for (const path of ["/", "/posts", "/posts/201", "/login"]) {
    const response = await fetch(site.url + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/html/);
    assert.match(await response.text(), /동네 이야기/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy")!, /script-src 'self'/);
  }
  const script = await fetch(`${site.url}/assets/app.js`);
  assert.equal(script.status, 200);
  const source = await script.text();
  assert.match(source, /\/api\/posts/);
  assert.match(source, /textContent/);
  assert.equal(source.includes("innerHTML"), false);
  assert.equal((await fetch(`${site.url}/assets/site.css`)).status, 200);
});

test("guests see only public metadata; private content requires authentication", async () => {
  const { body } = await json("/api/posts");
  assert.deepEqual(body.posts.map((post: { id: number }) => post.id), [201, 202]);
  assert.equal(JSON.stringify(body).includes("개인"), false);
  assert.equal(body.posts.some((post: object) => "body" in post), false);
  assert.equal((await json("/api/posts/201")).body.post.visibility, "public");
  const privatePost = await json("/api/posts/102");
  assert.equal(privatePost.response.status, 401);
  assert.equal("post" in privatePost.body, false);
  assert.equal((await json("/api/me")).response.status, 401);
});

test("all three fictional accounts authenticate; each reads only their own private posts", async () => {
  for (const [id, password, ownId] of [["user-a", "practice-a", 101], ["user-b", "practice-b", 102], ["admin", "practice-admin", 103]] as const) {
    const { response, cookie } = await login(id, password);
    assert.equal(response.status, 200);
    const header = response.headers.get("set-cookie")!;
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/);
    const body = await bodyOf(response);
    assert.deepEqual(Object.keys(body.user).sort(), ["id", "name", "role"]);
    assert.equal(JSON.stringify(body).includes(password), false);
    assert.equal((await json("/api/me", cookie)).body.user.id, id);
    assert.deepEqual((await json("/api/posts", cookie)).body.posts.map((post: { id: number }) => post.id), [ownId, 201, 202]);
    assert.equal((await json(`/api/posts/${ownId}`, cookie)).body.post.ownerId, id);
    for (const otherId of [101, 102, 103].filter(value => value !== ownId)) {
      const denied = await json(`/api/posts/${otherId}`, cookie);
      assert.equal(denied.response.status, 403);
      assert.equal("post" in denied.body, false);
      assert.equal(JSON.stringify(denied.body).includes("body"), false);
    }
    assert.equal((await json("/api/posts/999", cookie)).response.status, 404);
  }
});

test("invalid credentials, forged cookies and caller-supplied roles cannot authenticate", async () => {
  assert.equal((await login("user-a", "incorrect-password")).response.status, 401);
  assert.equal((await json("/api/me", "vulnlab_basic_session=forged; authjs.session-token=platform-cookie")).response.status, 401);
  const response = await fetch(`${site.url}/api/auth/login`, {
    method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user-a", password: "practice-a", role: "admin" }),
  });
  assert.equal(response.status, 400);
});

test("account switching invalidates the old session; logout revokes the active session", async () => {
  const a = await login("user-a", "practice-a");
  const b = await login("user-b", "practice-b", a.cookie);
  assert.equal((await json("/api/me", a.cookie)).response.status, 401);
  assert.equal((await json("/api/me", b.cookie)).body.user.id, "user-b");
  const response = await fetch(`${site.url}/api/auth/logout`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json", Cookie: b.cookie }, body: "{}" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal((await json("/api/me", b.cookie)).response.status, 401);
});

test("cross-site writes, invalid Host, invalid JSON and oversized input are rejected", async () => {
  for (const origin of [undefined, "http://evil.example", "null"]) {
    const response = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: "{}" });
    assert.equal(response.status, 403);
  }
  const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = http.get(`${site.url}/api/posts`, { headers: { Host: "evil.example" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject);
  });
  assert.equal(invalidHost, 403);
  for (const [body, contentType, status] of [["{", "application/json", 400], ["[]", "application/json", 400], ["{}", "text/plain", 415], [JSON.stringify({ password: "x".repeat(9000) }), "application/json", 413]] as const) {
    const response = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": contentType }, body });
    assert.equal(response.status, status);
  }
  assert.equal((await fetch(`${site.url}/api/posts/101`, { method: "DELETE", headers: { Origin: site.url } })).status, 405);
});

test("sessions expire and separate server instances do not share authentication", async () => {
  let now = 0;
  const auth = createAuth([{ id: "user-a", name: "A", role: "user", ...passwordRecord("fake") }], () => now);
  const cookie = auth.login({ id: "user-a", name: "A", role: "user" }, undefined).split(";")[0];
  assert.equal(auth.current(cookie)?.id, "user-a");
  now += 3600000;
  assert.equal(auth.current(cookie), undefined);
  const loggedIn = await login("user-a", "practice-a");
  const other = await createBasicSite({ port: 0 });
  try {
    assert.equal((await fetch(`${other.url}/api/me`, { headers: { Cookie: loggedIn.cookie } })).status, 401);
  } finally { await other.close(); }
});

test("HTML escaping treats markup as text", () => {
  assert.equal(escapeHtml('<script>"&\'</script>'), "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;");
});

test("IDOR HTTP comparison preserves normal authorization but exposes B's private post on the lab route", async () => {
  const a = await login("user-a", "practice-a");
  assert.equal(a.response.status, 200);
  const own = await json("/api/posts/101", a.cookie);
  assert.equal(own.response.status, 200);
  assert.equal(own.body.post.ownerId, "user-a");
  const denied = await json("/api/posts/102", a.cookie);
  assert.equal(denied.response.status, 403);
  assert.equal("post" in denied.body, false);

  const exposed = await json("/api/lab/vulnerable/posts/102", a.cookie);
  assert.equal(exposed.response.status, 200);
  assert.equal(exposed.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(exposed.body.post, {
    id: 102, ownerId: "user-b", title: "B의 개인 독서 메모",
    body: "사용자 B만 읽을 수 있는 가상 독서 기록입니다.",
    visibility: "private", createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal((await json("/api/posts/102", a.cookie)).response.status, 403);
  assert.deepEqual((await json("/api/posts", a.cookie)).body.posts.map(post => post.id), [101, 201, 202]);
  assert.equal((await json("/api/lab/vulnerable/posts/999", a.cookie)).response.status, 404);

  await fetch(`${site.url}/api/auth/logout`, {
    method: "POST", headers: { Origin: site.url, "Content-Type": "application/json", Cookie: a.cookie }, body: "{}",
  });
  assert.equal((await json("/api/lab/vulnerable/posts/102", a.cookie)).response.status, 401);
});

test("the vulnerable route requires a valid session even for public or missing posts", async () => {
  for (const cookie of [undefined, "vulnlab_basic_session=forged", "authjs.session-token=platform-cookie"]) {
    for (const id of [102, 201, 999]) {
      const denied = await json(`/api/lab/vulnerable/posts/${id}`, cookie);
      assert.equal(denied.response.status, 401);
      assert.equal("post" in denied.body, false);
    }
  }
});

test("IDOR activation is opt-in and rejected outside local development/test environments", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.BASIC_SITE_ENABLE_IDOR;
  try {
    process.env.NODE_ENV = "test";
    delete process.env.BASIC_SITE_ENABLE_IDOR;
    const disabled = await createBasicSite({ port: 0 });
    try {
      assert.equal(disabled.enableIdorLab, false);
      assert.equal((await fetch(`${disabled.url}/api/lab/vulnerable/posts/102`)).status, 404);
      assert.equal((await fetch(`${disabled.url}/api/posts/201`)).status, 200);
    } finally { await disabled.close(); }

    process.env.BASIC_SITE_ENABLE_IDOR = "1";
    const enabled = await createBasicSite({ port: 0 });
    try {
      assert.equal(enabled.enableIdorLab, true);
      assert.equal((await fetch(`${enabled.url}/api/lab/vulnerable/posts/102`)).status, 401);
      const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
        const request = http.get(`${enabled.url}/api/lab/vulnerable/posts/102`, { headers: { Host: "external.example" } }, response => {
          response.resume(); response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject);
      });
      assert.equal(invalidHost, 403);
    } finally { await enabled.close(); }

    process.env.NODE_ENV = "production";
    await assert.rejects(createBasicSite({ port: 0, enableIdorLab: true }), /production/);
    process.env.NODE_ENV = "staging";
    await assert.rejects(createBasicSite({ port: 0 }), /development\/test/);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.BASIC_SITE_ENABLE_IDOR; else process.env.BASIC_SITE_ENABLE_IDOR = originalFlag;
  }
});

test("the workshop records and replays actual GET requests with edited IDs and preserves normal blocking", async () => {
  const a = await login("user-a", "practice-a");
  assert.equal(a.response.status, 200);
  const sent: Request[] = [];
  const browserFetch = (request: Request) => {
    sent.push(request);
    assert.equal(request.method, "GET");
    assert.equal(request.credentials, "same-origin");
    assert.equal(request.redirect, "error");
    assert.equal(request.cache, "no-store");
    return fetch(request, { headers: { Cookie: a.cookie } });
  };
  const normalOwn = await requestPost("101", "normal", browserFetch, site.url);
  assert.equal(normalOwn.status, 200);
  const baseline = await requestPost("101", "vulnerable", browserFetch, site.url);
  assert.equal(isOwnBaseline(baseline, "user-a"), true);
  assert.equal(isIdorDiscovery(undefined, baseline, "user-a"), false);
  const changed = await requestPost("102", "vulnerable", browserFetch, site.url);
  assert.equal(changed.url, sent[2].url);
  assert.equal(changed.path, "/api/lab/vulnerable/posts/102");
  assert.equal(changed.status, 200);
  assert.equal(JSON.parse(changed.body).post.ownerId, "user-b");
  assert.match(JSON.parse(changed.body).post.body, /사용자 B/);
  assert.equal(isIdorDiscovery(baseline, changed, "user-a"), true);
  assert.equal(isIdorDiscovery(undefined, changed, "user-a"), false);
  assert.equal(isIdorDiscovery(baseline, changed, "user-b"), false);
  const publicPost = await requestPost("201", "vulnerable", browserFetch, site.url);
  assert.equal(isIdorDiscovery(baseline, publicPost, "user-a"), false);
  const normal = await requestPost("102", "normal", browserFetch, site.url);
  assert.equal(normal.status, 403);
  assert.equal(JSON.parse(normal.body).error, "FORBIDDEN");
  assert.equal("post" in normal.data, false);
  assert.equal(sent.length, 5);
  const guest = await requestPost("102", "vulnerable", fetch, site.url);
  assert.equal(guest.status, 401);
  assert.equal(isIdorDiscovery(baseline, guest, "user-a"), false);
  assert.equal(JSON.stringify(changed).includes(a.cookie), false);
});

test("the request editor only builds numeric post IDs on its two fixed endpoint paths", () => {
  for (const id of ["https://example.com", "../102", "102?admin=1", "102#x", "", "1".repeat(13)]) {
    assert.throws(() => postPath(id, "vulnerable"), /게시글 ID/);
  }
  assert.throws(() => postPath("102", "other"), /조회 방식/);
});

test("workshop pages truthfully show login and activation state without prefilled answers", async () => {
  const guest = await fetch(`${site.url}/lab/idor`);
  const guestHtml = await guest.text();
  assert.equal(guest.status, 200);
  assert.match(guestHtml, /사용자 A로 로그인/);
  assert.equal(guestHtml.includes('id="request-form"'), false);
  const a = await login("user-a", "practice-a");
  const page = await fetch(`${site.url}/lab/idor`, { headers: { Cookie: a.cookie } });
  const html = await page.text();
  assert.match(html, /id="request-fields" disabled/);
  assert.match(html, /id="lab-comparison" class="card" hidden/);
  assert.equal(html.includes('value="102"'), false);
  for (const path of ["/assets/lab.js", "/assets/http-client.js"]) {
    const response = await fetch(site.url + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/javascript/);
  }
  const disabled = await createBasicSite({ port: 0, enableIdorLab: false });
  try {
    const response = await fetch(`${disabled.url}/lab/idor`);
    const body = await response.text();
    assert.match(body, /실습이 비활성화/);
    assert.equal(body.includes('id="request-form"'), false);
    assert.equal(body.includes('src="/assets/lab.js"'), false);
    assert.equal((await fetch(`${disabled.url}/api/lab/vulnerable/posts/102`)).status, 404);
  } finally { await disabled.close(); }
});

test("six-stage lesson withholds response evidence, source code and quiz explanations initially", async () => {
  const a = await login("user-a", "practice-a");
  const html = await (await fetch(`${site.url}/lab/idor`, { headers: { Cookie: a.cookie } })).text();
  for (let stage = 1; stage <= 6; stage++) assert.ok(html.includes(`data-stage="${stage}"`));
  assert.match(html, /id="lab-analysis"[^>]*hidden/);
  assert.match(html, /id="lab-quiz"[^>]*hidden/);
  assert.match(html, /id="analysis-facts"><\/dl>/);
  assert.match(html, /id="quiz-questions"><\/div>/);
  assert.equal(html.includes("export function getVulnerablePost"), false);
  assert.equal(html.includes('value="102"'), false);
  assert.match(html, /새로고침하면/);
  assert.match(html, /IDOR\(Insecure Direct Object Reference\)/);
  const script = await (await fetch(`${site.url}/assets/lab.js`)).text();
  assert.equal(script.includes("102"), false, "hints must not disclose the exact target ID");
  assert.equal(script.includes("innerHTML"), false);
});

test("code excerpts match the real implementation, require login and respect activation", async () => {
  const source = await readFile(new URL("../src/features/posts.ts", import.meta.url), "utf8");
  const snippets = await readLessonCode();
  for (const name of ["getVulnerablePost", "getPost", "canReadPost"]) {
    assert.ok(source.includes(snippets[name]));
    assert.ok(snippets[name].startsWith(`export function ${name}(`));
    assert.ok(snippets[name].endsWith("\n}"));
  }
  assert.equal(snippets.getVulnerablePost.includes("canReadPost"), false);
  assert.ok(snippets.getPost.includes("if (!canReadPost(user, post))"));
  assert.equal((await fetch(`${site.url}/api/lab/idor-code`)).status, 401);
  const a = await login("user-a", "practice-a");
  const result = await fetch(`${site.url}/api/lab/idor-code`, { headers: { Cookie: a.cookie } });
  assert.equal(result.headers.get("access-control-allow-origin"), null);
  assert.deepEqual((await result.json() as { snippets: Record<string, string> }).snippets, snippets);
  const disabled = await createBasicSite({ port: 0, enableIdorLab: false });
  try { assert.equal((await fetch(`${disabled.url}/api/lab/idor-code`)).status, 404); }
  finally { await disabled.close(); }
});

test("learning completion requires real discovery, matching normal comparison and a passing quiz", async () => {
  for (const attackSucceeded of [false, true]) for (const comparisonDone of [false, true]) for (const quizPassed of [false, true]) {
    assert.equal(learningComplete({ attackSucceeded, comparisonDone, quizPassed }), attackSucceeded && comparisonDone && quizPassed);
  }
  assert.equal(questions.length, 3);
  assert.ok(gradeQuiz([]).every((result: { correct: boolean; explanation: string }) => !result.correct && result.explanation.length > 0));
  const correct = questions.map((question: { answer: string }) => question.answer);
  assert.ok(gradeQuiz(correct).every((result: { correct: boolean }) => result.correct));
  assert.equal(gradeQuiz(["wrong", ...correct.slice(1)])[0].correct, false);
  const a = await login("user-a", "practice-a");
  const browserFetch = (request: Request) => fetch(request, { headers: { Cookie: a.cookie } });
  const baseline = await requestPost("101", "vulnerable", browserFetch, site.url);
  const discovery = await requestPost("102", "vulnerable", browserFetch, site.url);
  const normal = await requestPost("102", "normal", browserFetch, site.url);
  assert.deepEqual(analyzeDiscovery(baseline, discovery, "user-a"), { userId: "user-a", requestedId: "102", ownerId: "user-b", visibility: "private", status: 200 });
  assert.equal(analyzeDiscovery(undefined, discovery, "user-a"), undefined);
  assert.equal(analyzeDiscovery(baseline, { ...discovery, data: { post: { ...discovery.data.post, body: "" } } }, "user-a"), undefined);
  assert.equal(analyzeDiscovery(baseline, baseline, "user-a"), undefined);
  assert.equal(isNormalComparison(discovery, normal, "user-a"), true);
  for (const bad of [{ ...normal, status: 200 }, { ...normal, path: "/api/posts/999" }, { ...normal, data: { error: "FORBIDDEN", post: {} } }, { ...normal, data: { error: "OTHER" } }]) {
    assert.equal(isNormalComparison(discovery, bad, "user-a"), false);
  }
  assert.equal(isNormalComparison(discovery, normal, "user-b"), false);
  assert.equal(isNormalComparison(undefined, normal, "user-a"), false);
});
