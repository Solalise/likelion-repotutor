import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";
import { selectedGuide } from "../src/guide.ts";

const mainContent = (html: string) => html.match(/<main>([\s\S]*?)<\/main>/)![1];
const withoutGuide = (html: string) => html.replace(/<aside class="learning-guide"[\s\S]*?<\/aside>/, "");

test("community pages contain no learning UI before or after login; only the selected guide does", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: false });
  try {
    const login = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const sessions: Record<string, string>[] = [{}, { Cookie: cookie }];
    for (const headers of sessions) {
      for (const path of ["/", "/posts", "/login", "/posts/201"]) {
        const normal = await (await fetch(site.url + path, { headers })).text();
        assert.doesNotMatch(normal, /IDOR|SQL Injection|SQLI|실습|VulnLab|LOCAL PRACTICE|개발 전용|observed-request|practice-a/);
        assert.match(normal, /<title>동네 이야기<\/title>/);
        for (const lab of ["idor", "sqli"]) {
          const html = await (await fetch(`${site.url}${path}?lab=${lab}`, { headers })).text();
          assert.equal(mainContent(html).replace(/\?lab=(idor|sqli)/g, ""), mainContent(normal));
          assert.doesNotMatch(withoutGuide(html), /IDOR|SQL Injection|SQLI|실습|VulnLab|LOCAL PRACTICE|개발 전용|observed-request|practice-a/);
          const panel = html.match(/<aside class="learning-guide"[\s\S]*?<\/aside>/)![0];
          assert.match(panel, lab === "idor" ? /IDOR/ : /SQL Injection/);
          assert.doesNotMatch(panel, lab === "idor" ? /SQL Injection|SQLI/ : /IDOR/);
          assert.equal(panel.includes('id="observed-request"'), lab === "idor");
          assert.match(panel, /학습용 가상 계정/);
        }
      }
    }
  } finally { await site.close(); }
});

test("ordinary and unsupported entries remain exactly the ordinary community", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: false });
  try {
    const normal = await (await fetch(site.url)).text();
    assert.equal(normal.includes('class="learning-guide"'), false);
    assert.ok(normal.includes('id="posts"'));
    assert.ok(normal.includes('id="search-form"'));
    for (const suffix of ["?lab=unknown", "?lab=", "?lab=IDOR", "?lab=idor&lab=sqli", `?lab=${encodeURIComponent('<script>alert(1)</script>')}`]) {
      assert.equal(await (await fetch(site.url + suffix)).text(), normal);
    }
    assert.equal(selectedGuide(new URLSearchParams("lab=idor")), "idor");
    assert.equal(selectedGuide(new URLSearchParams("lab=sqli")), "sqli");
  } finally { await site.close(); }
});

test("both guides wrap the same board, use a native disclosure, and preserve navigation context", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: false });
  try {
    const normal = await (await fetch(site.url)).text();
    for (const lab of ["idor", "sqli"]) {
      const html = await (await fetch(`${site.url}/?lab=${lab}`)).text();
      assert.equal(mainContent(html), mainContent(normal));
      assert.match(html, /<aside class="learning-guide" aria-label="학습 가이드">/);
      assert.match(html, /<details class="guide-panel" open>\s*<summary>/);
      assert.match(html, /접기/);
      assert.match(html, /펼치기/);
      assert.ok(html.includes(`data-guide="${lab}"`));
      assert.ok(html.includes(`href="/login?lab=${lab}"`));
      assert.ok(html.includes(`href="/posts?lab=${lab}"`));
      assert.equal(html.includes('src="/assets/lab.js"'), false);
      const detail = await (await fetch(`${site.url}/posts/201?lab=${lab}`)).text();
      assert.ok(detail.includes('id="post"'));
      assert.ok(detail.includes(`href="/posts?lab=${lab}"`));
      const login = await (await fetch(`${site.url}/login?lab=${lab}`)).text();
      assert.ok(login.includes('id="login-form"'));
      assert.ok(login.includes(`data-guide="${lab}"`));
      if (lab === "idor") {
        assert.match(html, /IDOR\(Insecure Direct Object Reference\)/);
        assert.match(html, /id="integrated-idor"/);
        assert.match(html, /id="quiz-form"/);
      } else {
        assert.match(html, /SQL Injection/);
        assert.match(html, /아직 제공하지 않습니다/);
        assert.match(html, /href="\/\?lab=sqli#search-form"/);
        assert.equal(html.includes('id="request-form"'), false);
      }
    }
    const css = await (await fetch(`${site.url}/assets/site.css`)).text();
    assert.match(css, /@media\(max-width:900px\)/);
    assert.match(css, /\.learning-guide\{order:-1;position:static/);
  } finally { await site.close(); }
});

test("guide entries cannot enable vulnerable APIs without server flags, including after login", async () => {
  const previous = { idor: process.env.BASIC_SITE_ENABLE_IDOR, sqli: process.env.BASIC_SITE_ENABLE_SQLI };
  delete process.env.BASIC_SITE_ENABLE_IDOR;
  delete process.env.BASIC_SITE_ENABLE_SQLI;
  let site: Awaited<ReturnType<typeof createBasicSite>> | undefined;
  try {
    site = await createBasicSite({ port: 0 });
    const response = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    for (const lab of ["idor", "sqli"]) {
      const html = await (await fetch(`${site.url}/?lab=${lab}`, { headers: { Cookie: cookie } })).text();
      assert.ok(html.includes("user-a"));
      assert.ok(html.includes('id="logout"'));
      assert.equal((await fetch(`${site.url}/api/lab/vulnerable/posts/102?lab=${lab}`, { headers: { Cookie: cookie } })).status, 404);
      assert.equal((await fetch(`${site.url}/api/lab/vulnerable/search?q=x&lab=${lab}`, { headers: { Cookie: cookie } })).status, 404);
      const posts = await (await fetch(`${site.url}/api/posts`, { headers: { Cookie: cookie } })).json() as { posts: { id: number }[] };
      assert.deepEqual(posts.posts.map(post => post.id), [101, 201, 202]);
      assert.equal((await fetch(`${site.url}/api/posts/101`, { headers: { Cookie: cookie } })).status, 200);
      assert.equal((await fetch(`${site.url}/api/search?q=${encodeURIComponent("산책")}`)).status, 200);
    }
    assert.match(await (await fetch(`${site.url}/lab/idor?lab=idor`, { headers: { Cookie: cookie } })).text(), /실습이 비활성화/);
  } finally {
    await site?.close();
    if (previous.idor === undefined) delete process.env.BASIC_SITE_ENABLE_IDOR; else process.env.BASIC_SITE_ENABLE_IDOR = previous.idor;
    if (previous.sqli === undefined) delete process.env.BASIC_SITE_ENABLE_SQLI; else process.env.BASIC_SITE_ENABLE_SQLI = previous.sqli;
  }
});
