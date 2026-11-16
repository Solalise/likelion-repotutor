import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";
import { initPractice, sendPractice } from "../public/practice.js";
import { publishCommunitySession } from "../public/http-client.js";

class Control {
  value = "";
  disabled = false;
  textContent = "";
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  async fire(type) { await this.listeners.get(type)?.({ preventDefault() {} }); }
}

test("free practice handlers reproduce IDOR and SQLi before any guide or quiz and reset on account changes", async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const site = await createBasicSite({ port: 0, enableIdorLab: true, enableSqliLab: true, enableXssLab: true, enableAuthzLab: true });
  const originals = { fetch: globalThis.fetch, location: globalThis.location };
  let dispose;
  try {
    let cookie;
    globalThis.location = { origin: site.url };
    globalThis.fetch = (request, options) => {
      const headers = new Headers(request.headers);
      if (cookie) headers.set("Cookie", cookie);
      return originals.fetch(new Request(request, { headers }), options);
    };
    const login = await originals.fetch(site.url + "/api/auth/login", { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];

    for (const kind of ["idor", "sqli"]) {
      const html = await (await originals.fetch(`${site.url}/?lab=${kind}`)).text();
      const direct = html.match(/<section class="quick-practice"[\s\S]*?<\/section>/)[0];
      assert.doesNotMatch(direct, /disabled|hidden|data-stages/);
      assert.ok(html.indexOf('id="quick-form"') < html.indexOf('<details class="guide-panel">'));
      assert.match(html, /id=".*quiz-form"/);
      assert.match(html, /6단계 가이드/);
      const nodes = new Map(["quick-form", "quick-submit", "quick-value", "quick-mode", "quick-status", "quick-result", "quick-comparison"].map(id => [`#${id}`, new Control()]));
      // There is deliberately no lesson DOM or progress storage in this harness.
      const root = { querySelector: selector => nodes.get(selector) };
      dispose = initPractice(kind, root);
      nodes.get("#quick-value").value = kind === "idor" ? "102" : "' OR 1=1 -- ";
      nodes.get("#quick-mode").value = "vulnerable";
      await nodes.get("#quick-form").fire("submit");
      const vulnerable = nodes.get("#quick-result").textContent;
      assert.match(vulnerable, /HTTP 200/);
      assert.match(vulnerable, kind === "idor" ? /user-b/ : /private/);
      nodes.get("#quick-mode").value = "safe";
      await nodes.get("#quick-form").fire("submit");
      assert.match(nodes.get("#quick-result").textContent, kind === "idor" ? /HTTP 403/ : /"posts":\[\]/);
      assert.match(nodes.get("#quick-comparison").textContent, /동일 입력 비교/);
      assert.match(nodes.get("#quick-comparison").textContent, kind === "idor" ? /안전 HTTP 403/ : /비공개 글 2개/);
      assert.equal(nodes.get("#quick-submit").disabled, false);
      publishCommunitySession();
      assert.doesNotMatch(nodes.get("#quick-result").textContent, /HTTP 200|user-b|private/);
      assert.match(nodes.get("#quick-status").textContent, /세션이 바뀌었습니다/);
      nodes.get("#quick-mode").value = "vulnerable";
      cookie = undefined;
      await nodes.get("#quick-form").fire("submit");
      assert.match(nodes.get("#quick-status").textContent, /로그인이 필요/);
      cookie = login.headers.get("set-cookie").split(";")[0];
      globalThis.fetch = async () => { throw new Error("offline"); };
      await nodes.get("#quick-form").fire("submit");
      assert.match(nodes.get("#quick-status").textContent, /서버 실행·연결 상태/);
      assert.doesNotMatch(nodes.get("#quick-result").textContent, /HTTP 200/);
      globalThis.fetch = (request, options) => originals.fetch(new Request(request, { headers: { Cookie: cookie } }), options);
      let release;
      globalThis.fetch = () => new Promise(resolve => { release = resolve; });
      const pending = nodes.get("#quick-form").fire("submit");
      publishCommunitySession();
      release(new Response(JSON.stringify({ post: { ownerId: "stale-user", visibility: "private" } }), { status: 200 }));
      await pending;
      assert.doesNotMatch(nodes.get("#quick-result").textContent, /stale-user|HTTP 200/);
      globalThis.fetch = (request, options) => originals.fetch(new Request(request, { headers: { Cookie: cookie } }), options);
      dispose(); dispose = undefined;
    }
    for (const kind of ["xss", "authz"]) {
      const html = await (await originals.fetch(`${site.url}/lab/${kind}`)).text();
      assert.match(html, /기초 학습이나 퀴즈 없이/);
      assert.match(html, /<details class="card extra-guide"><summary>/);
      assert.ok(html.indexOf('id="exercise"') < html.indexOf('<details class="card extra-guide">'));
      assert.doesNotMatch(html.match(/<form id="exercise">[\s\S]*?<\/form>/)[0], /disabled/);
    }
    assert.equal((await originals.fetch(site.url + "/assets/practice.js")).status, 200);
  } finally {
    dispose?.();
    globalThis.fetch = originals.fetch; globalThis.location = originals.location;
    await site.close();
    if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
  }
});

test("free practice rejects external targets and unsupported modes before fetching", async () => {
  const fetcher = () => assert.fail("invalid input must not be fetched");
  await assert.rejects(() => sendPractice("idor", "https://example.com", "vulnerable", fetcher, "http://127.0.0.1:4400"), /게시글 ID/);
  assert.throws(() => sendPractice("idor", "101", "unknown", fetcher, "http://127.0.0.1:4400"), /실습 모드/);
  assert.throws(() => sendPractice("unknown", "x", "safe", fetcher, "http://127.0.0.1:4400"), /지원하지 않는/);
});
