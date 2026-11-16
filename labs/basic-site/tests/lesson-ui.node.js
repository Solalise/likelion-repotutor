import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";
import { page } from "../src/pages.ts";
import { readSqliLessonCode } from "../src/lessonCode.ts";

// Minimal DOM contract harness: exercise the actual event handlers against real HTTP.
// This does not verify layout, browser focus or native form validation.
class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.textContent = ""; this.hidden = false; this.value = ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  reset() {}
  async fire(type) { await this.listeners[type]?.({ preventDefault() {}, currentTarget: this }); }
}

test("SQLi observes only real normal community searches and gates later stages on evidence", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: false });
  const original = Object.fromEntries(["document", "location", "fetch", "FormData", "window"].map(name => [name, globalThis[name]]));
  let dispose;
  try {
    const html = page("posts", undefined, undefined, false, "sqli");
    const nodes = new Map();
    for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) nodes.set(`#${match[1]}`, new Element());
    const stages = Array.from({ length: 6 }, (_, index) => { const e = new Element("button"); e.dataset.stage = String(index + 1); return e; });
    const panels = [1, 2, 3, 4, 5, 6].map(index => { const e = new Element(); e.dataset.stages = String(index); return e; });
    const dynamic = [];
    const find = selector => /^\[data-stage="\d"\]$/.test(selector) ? stages[Number(selector.match(/\d/)[0]) - 1] : nodes.get(selector) || dynamic.find(element => `#${element.id}` === selector);
    const root = { dataset: {}, querySelector: find, querySelectorAll: selector => selector === "[data-stage]" ? stages : selector === "[data-quiz-answer]" ? dynamic.filter(element => element.dataset.quizAnswer) : selector === "[data-quiz-explanation]" ? dynamic.filter(element => element.dataset.quizExplanation) : panels };
    nodes.set("#integrated-sqli", root);
    const disclosure = new Element("details"); disclosure.open = true;
    const button = new Element("button"); nodes.get("#search-form").querySelector = () => button;
    const sent = [];
    globalThis.location = { origin: site.url };
    globalThis.document = { body: { dataset: { page: "posts", guide: "sqli" } },
      querySelector: selector => selector === ".guide-panel" ? disclosure : nodes.get(selector),
      createElement: tag => { const element = new Element(tag); dynamic.push(element); return element; },
      createTextNode: text => ({ textContent: String(text) }), addEventListener() {},
    };
    globalThis.window = { addEventListener() {} };
    globalThis.fetch = (input, options) => {
      const url = typeof input === "string" ? new URL(input, site.url) : new URL(input.url);
      sent.push({ url: url.href, method: typeof input === "string" ? "GET" : input.method });
      return original.fetch(typeof input === "string" ? url : input, options);
    };
    let query = "산책";
    globalThis.FormData = class { get() { return query; } };
    const { initSqliLesson, isNormalSearchObservation } = await import("../public/sqli-lesson.js");
    const { publishCommunityPost, publishCommunitySearch, publishCommunitySession, requestPost, requestSearch } = await import("../public/http-client.js");
    dispose = initSqliLesson(root);
    await import("../public/app.js?sqli-observation");
    const waitFor = async predicate => {
      for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
      assert.fail("normal search UI did not finish");
    };
    await waitFor(() => nodes.get("#posts").attributes["aria-busy"] === "false");
    assert.equal(nodes.get("#sqli-search-record").textContent, "아직 관찰된 검색 요청이 없습니다");
    assert.equal(sent.some(record => new URL(record.url).pathname.includes("search")), false);
    await nodes.get("#sqli-start").fire("click");
    assert.equal(stages[1].attributes["aria-current"], "step");
    assert.equal(stages[1].attributes["data-complete"], undefined);
    publishCommunityPost(await requestPost("201", "normal", globalThis.fetch, site.url));
    assert.equal(stages[1].attributes["data-complete"], undefined);
    assert.equal(nodes.get("#sqli-search-record").textContent, "아직 관찰된 검색 요청이 없습니다");

    await nodes.get("#search-form").fire("submit");
    const actual = sent.find(record => new URL(record.url).pathname === "/api/search");
    assert.ok(actual);
    assert.equal(actual.method, "GET");
    assert.equal(new URL(actual.url).searchParams.get("q"), query);
    assert.ok(nodes.get("#sqli-search-record").textContent.includes(actual.url));
    assert.match(nodes.get("#sqli-search-record").textContent, /검색어: 산책/);
    assert.match(nodes.get("#sqli-search-record").textContent, /HTTP 200/);
    assert.equal(stages[1].attributes["data-complete"], "true");
    assert.match(nodes.get("#sqli-search-feedback").textContent, /2단계 완료/);
    assert.equal(nodes.get("#sqli-search-results").children.length, 2);
    assert.match(nodes.get("#sqli-search-results").children[1].textContent, /동네 산책 안내[\s\S]*public/);
    assert.equal(nodes.get("#search-status").textContent, "검색 결과 1개");
    assert.equal(sent.some(record => new URL(record.url).pathname.startsWith("/api/lab/")), false);
    disclosure.open = false;
    await stages[0].fire("click"); await stages[1].fire("click");
    disclosure.open = true;
    assert.equal(stages[1].attributes["data-complete"], "true");
    for (const stage of stages.slice(2)) {
      assert.equal(stage.disabled, true); await stage.fire("click");
      assert.equal(stages[1].attributes["aria-current"], "step");
    }
    const successful = await requestSearch(query, globalThis.fetch, site.url);
    assert.equal(isNormalSearchObservation(successful), true);
    for (const invalid of [{ ...successful, status: 403 }, { ...successful, query: "different" }, { ...successful, data: { dataset: "other", posts: [] } }, { ...successful, data: { dataset: "sqli-practice", posts: [{ id: 1, title: "x", body: "x", visibility: "private" }] } }]) assert.equal(isNormalSearchObservation(invalid), false);
    const before = nodes.get("#sqli-search-record").textContent;
    publishCommunitySearch({ ...successful, path: "/api/lab/vulnerable/search" });
    assert.equal(nodes.get("#sqli-search-record").textContent, before);
    query = "x".repeat(201);
    await nodes.get("#search-form").fire("submit");
    assert.match(nodes.get("#sqli-search-record").textContent, /HTTP 400/);
    assert.equal(stages[1].attributes["data-complete"], undefined);
    query = "없는검색결과";
    await nodes.get("#search-form").fire("submit");
    assert.equal(nodes.get("#search-status").textContent, "검색 결과 0개");
    assert.equal(stages[1].attributes["data-complete"], "true");
    publishCommunitySession();
    assert.equal(stages[1].attributes["data-complete"], undefined);
    assert.equal(nodes.get("#sqli-search-record").textContent, "아직 관찰된 검색 요청이 없습니다");
  } finally { dispose?.(); Object.assign(globalThis, original); await site.close(); }
});

test("SQLi stages 3-6 use actual responses, source code, retryable quiz and separate completion state", async () => {
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: true });
  if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
  const original = Object.fromEntries(["document", "location", "fetch"].map(name => [name, globalThis[name]]));
  let dispose;
  try {
    const login = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const html = page("posts", { id: "user-a", name: "A", role: "user" }, undefined, false, "sqli");
    const nodes = new Map();
    for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) nodes.set(`#${match[1]}`, new Element());
    const stages = Array.from({ length: 6 }, (_, index) => { const e = new Element("button"); e.dataset.stage = String(index + 1); return e; });
    const panels = [1, 2, 3, 4, 5, 6].map(index => { const e = new Element(); e.dataset.stages = String(index); return e; });
    const dynamic = [];
    const find = selector => /^\[data-stage="\d"\]$/.test(selector) ? stages[Number(selector.match(/\d/)[0]) - 1] : nodes.get(selector) || dynamic.find(element => `#${element.id}` === selector);
    const root = { dataset: {}, querySelector: find, querySelectorAll: selector => selector === "[data-stage]" ? stages : selector === "[data-quiz-answer]" ? dynamic.filter(element => element.dataset.quizAnswer) : selector === "[data-quiz-explanation]" ? dynamic.filter(element => element.dataset.quizExplanation) : panels };
    nodes.set("#integrated-sqli", root);
    const disclosure = new Element("details"); disclosure.open = true;
    let failPath;
    let invalidNormal = false;
    const sent = [];
    globalThis.location = { origin: site.url };
    globalThis.document = { body: { dataset: { page: "posts", guide: "sqli" } },
      querySelector: selector => selector === ".guide-panel" ? disclosure : nodes.get(selector),
      createElement: tag => { const element = new Element(tag); dynamic.push(element); return element; },
      createTextNode: text => ({ textContent: String(text) }), addEventListener() {},
    };
    globalThis.fetch = async (input, options) => {
      const request = input instanceof Request ? input : new Request(new URL(input, site.url), options);
      const path = new URL(request.url).pathname;
      sent.push(request);
      if (path === failPath) throw new Error("simulated connection failure");
      if (invalidNormal && path === "/api/search") return Response.json({ error: "TEMPORARY" }, { status: 503 });
      const headers = new Headers(request.headers); headers.set("Cookie", cookie);
      return original.fetch(request, { headers });
    };
    const { initSqliLesson } = await import("../public/sqli-lesson.js");
    const { publishCommunitySearch, requestSearch } = await import("../public/http-client.js");
    dispose = initSqliLesson(root);
    const waitFor = async predicate => {
      for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
      assert.fail("SQLi stages 3-4 did not reach the expected state");
    };
    const stage = () => stages.findIndex(item => item.attributes["aria-current"] === "step") + 1;
    const normal = await requestSearch("산책", globalThis.fetch, site.url);
    publishCommunitySearch(normal);
    assert.equal(stages[1].attributes["data-complete"], "true");
    await nodes.get("#sqli-edit-start").fire("click");
    assert.equal(stage(), 3);
    assert.equal(nodes.get("#sqli-request-query").value, "산책");

    const payload = "' OR 1=1 --";
    nodes.get("#sqli-request-query").value = payload;
    nodes.get("#sqli-request-query").fire("input");
    assert.ok(nodes.get("#sqli-request-url").value.startsWith(`${site.url}/api/lab/vulnerable/search?q=`));
    failPath = "/api/lab/vulnerable/search";
    await nodes.get("#sqli-request-form").fire("submit");
    await waitFor(() => nodes.get("#sqli-replay-feedback").textContent.includes("다시 시도하세요"));
    assert.equal(stages[2].attributes["data-complete"], undefined);
    assert.match(nodes.get("#sqli-replay-record").textContent, /실제 HTTP 응답을 받지 못했습니다/);
    assert.equal(nodes.get("#sqli-request-fields").disabled, false);

    failPath = undefined;
    await nodes.get("#sqli-request-form").fire("submit");
    await waitFor(() => stages[2].attributes["data-complete"] === "true");
    assert.equal(stage(), 3);
    assert.match(nodes.get("#sqli-replay-record").textContent, /GET .*\/api\/lab\/vulnerable\/search\?q=/);
    assert.match(nodes.get("#sqli-replay-record").textContent, /검색어: ' OR 1=1 --/);
    assert.match(nodes.get("#sqli-replay-record").textContent, /HTTP 200/);
    assert.match(nodes.get("#sqli-education-results").children.map(item => item.textContent).join("\n"), /visibility: private/);
    assert.ok(sent.some(request => new URL(request.url).pathname === "/api/lab/vulnerable/search" && new URL(request.url).searchParams.get("q") === payload));
    assert.equal(nodes.get("#sqli-analysis-start").disabled, false);

    await nodes.get("#sqli-analysis-start").fire("click");
    assert.equal(stage(), 4);
    invalidNormal = true;
    await nodes.get("#sqli-compare").fire("click");
    await waitFor(() => nodes.get("#sqli-comparison-record").textContent.includes("HTTP 503"));
    assert.equal(stages[3].attributes["data-complete"], undefined);
    assert.match(nodes.get("#sqli-reproduction-state").textContent, /판정하지 않았습니다/);
    assert.equal(nodes.get("#sqli-compare").disabled, false);

    invalidNormal = false;
    await nodes.get("#sqli-compare").fire("click");
    await waitFor(() => stages[3].attributes["data-complete"] === "true");
    assert.equal(stage(), 4);
    assert.match(nodes.get("#sqli-education-record").textContent, /HTTP 200/);
    assert.match(nodes.get("#sqli-comparison-record").textContent, /GET .*\/api\/search\?q=/);
    assert.match(nodes.get("#sqli-comparison-record").textContent, /HTTP 200/);
    assert.match(nodes.get("#sqli-education-results").children.map(item => item.textContent).join("\n"), /visibility: private/);
    assert.equal(nodes.get("#sqli-comparison-results").children.length, 1);
    assert.match(nodes.get("#sqli-comparison-results").children[0].textContent, /실제 검색 결과 0개/);
    assert.match(nodes.get("#sqli-reproduction-state").textContent, /조건 우회 재현 확인/);
    assert.equal(stages[4].disabled, false);
    assert.equal(stages[5].disabled, true);

    await nodes.get("#sqli-code-start").fire("click");
    assert.equal(stage(), 5);
    await waitFor(() => nodes.get("#sqli-code-confirm").disabled === false);
    const expectedCode = await readSqliLessonCode();
    assert.match(nodes.get("#sqli-code-source").textContent, /labs\/basic-site\/src\/features\/search.ts:/);
    assert.equal(nodes.get("#sqli-code-snippet").textContent, expectedCode.snippet);
    assert.match(expectedCode.snippet, /vulnerable \?/);
    assert.match(expectedCode.snippet, /ESCAPE '!'/);
    assert.equal(nodes.get("#sqli-quiz-start").disabled, true);
    await nodes.get("#sqli-code-confirm").fire("click");
    assert.equal(stages[4].attributes["data-complete"], "true");
    assert.equal(nodes.get("#sqli-quiz-start").disabled, false);
    disclosure.open = false; disclosure.open = true;
    assert.equal(stage(), 5);
    await nodes.get("#sqli-quiz-start").fire("click");
    assert.equal(stage(), 6);
    const answerInputs = dynamic.filter(element => element.dataset.quizAnswer);
    assert.equal(answerInputs.length, 12);
    answerInputs.forEach(input => { input.checked = input.value === "3"; });
    await nodes.get("#sqli-quiz-form").fire("submit");
    assert.match(nodes.get("#sqli-quiz-feedback").textContent, /0\/3/);
    assert.equal(nodes.get("#sqli-learning-complete").hidden, true);
    assert.ok(dynamic.filter(element => element.dataset.quizExplanation).every(element => element.textContent.startsWith("오답 ·")));
    const correct = ["0", "1", "1"];
    answerInputs.forEach(input => { input.checked = input.value === correct[Number(input.dataset.quizQuestion)]; });
    await nodes.get("#sqli-quiz-form").fire("submit");
    assert.equal(stages[5].attributes["data-complete"], "true");
    assert.equal(nodes.get("#sqli-learning-complete").hidden, false);
    assert.match(nodes.get("#sqli-completion-reproduction").textContent, /취약점 재현/);
    assert.match(nodes.get("#sqli-quiz-feedback").textContent, /3문제 모두 정답/);
    disclosure.open = false; disclosure.open = true;
    assert.equal(nodes.get("#sqli-learning-complete").hidden, false);
    const { publishCommunitySession } = await import("../public/http-client.js");
    publishCommunitySession();
    assert.equal(stage(), 1);
    assert.equal(nodes.get("#sqli-learning-complete").hidden, true);
    assert.equal(stages[4].attributes["data-complete"], undefined);
  } finally {
    dispose?.(); Object.assign(globalThis, original); await site.close();
  }
});

test("community detail loads without a request inspector and search feedback contains no lab labels", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: false });
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, FormData: globalThis.FormData };
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("community UI did not finish its HTTP request");
  };
  try {
    globalThis.location = { origin: site.url };
    globalThis.fetch = (input, options) => original.fetch(typeof input === "string" ? new URL(input, site.url) : input, options);
    const article = new Element();
    const nodes = new Map([["#post", article], ["#message", new Element()]]);
    globalThis.document = { body: { dataset: { page: "post", postId: "201" } }, querySelector: selector => nodes.get(selector), createElement: tag => new Element(tag) };
    await import("../public/app.js?community-detail");
    await waitFor(() => article.attributes["aria-busy"] === "false");
    assert.equal(article.children[1].tag, "h1");
    assert.equal(article.children[1].textContent.includes("열 수 없어요"), false);
    assert.ok(article.children.some(child => child.className === "post-body"));

    const form = new Element("form");
    const button = new Element("button");
    form.querySelector = () => button;
    nodes.set("#search-form", form);
    nodes.set("#search-status", new Element());
    nodes.set("#search-results", new Element());
    globalThis.document.body.dataset = { page: "login" };
    globalThis.FormData = class { get() { return "산책"; } };
    await import("../public/app.js?community-search");
    const pending = form.fire("submit");
    assert.equal(nodes.get("#search-status").textContent, "게시글을 검색하고 있습니다…");
    await pending;
    assert.equal(nodes.get("#search-status").textContent, "검색 결과 1개");
    assert.equal(nodes.get("#search-results").children.length, 1);
    assert.equal(button.disabled, false);
  } finally {
    Object.assign(globalThis, original);
    await site.close();
  }
});

test("integrated community navigation feeds real requests and preserves the full lesson through completion", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: true });
  const names = ["document", "location", "fetch", "FormData", "DOMParser", "history", "window"];
  const original = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  let dispose;
  try {
    const login = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const html = await (await fetch(`${site.url}/?lab=idor`, { headers: { Cookie: cookie } })).text();
    const nodes = new Map();
    const all = [];
    for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const e = new Element(); e.hidden = match[0].includes(" hidden"); nodes.set(`#${match[1]}`, e);
    }
    const stages = Array.from({ length: 6 }, (_, i) => { const e = new Element("button"); e.dataset.stage = String(i + 1); return e; });
    const panels = [...html.matchAll(/data-stages="([^"]+)"/g)].map(match => { const e = new Element(); e.dataset.stages = match[1]; return e; });
    const find = selector => nodes.get(selector) || all.find(e => `#${e.id}` === selector);
    const root = { dataset: { enabled: "true" }, querySelector: find, querySelectorAll: selector => selector === "[data-stage]" ? stages : selector === "[data-stages]" ? panels : selector === "#lab-posts button" ? [] : all.filter(e => e.className === "quiz-explanation") };
    nodes.set("#integrated-idor", root);
    const disclosure = new Element("details"); disclosure.open = true;
    let currentMain;
    let currentHeader;
    let viewNodes = new Map();
    function parseView(source) {
      const maps = new Map();
      const mainHtml = source.match(/<main>([\s\S]*?)<\/main>/)[1];
      for (const match of mainHtml.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const e = new Element(); e.querySelector = () => new Element("button"); maps.set(`#${match[1]}`, e);
      }
      const main = new Element("main"); main.maps = maps;
      const header = new Element("header");
      main.replaceWith = next => { currentMain = next; viewNodes = next.maps; };
      header.replaceWith = next => { currentHeader = next; };
      return { body: { dataset: { guide: source.match(/data-guide="([^"]+)"/)?.[1], page: source.match(/data-page="([^"]+)"/)[1], postId: source.match(/data-post-id="([^"]+)"/)?.[1] } }, querySelector: selector => selector === "main" ? main : selector === ".topbar" ? header : selector === "#integrated-idor" ? root : maps.get(selector) };
    }
    const initial = parseView(html);
    currentMain = initial.querySelector("main"); currentHeader = initial.querySelector(".topbar"); viewNodes = currentMain.maps;
    const events = {};
    globalThis.document = {
      body: initial.body,
      querySelector: selector => selector === "main" ? currentMain : selector === ".topbar" ? currentHeader : selector === ".guide-panel" ? disclosure : viewNodes.get(selector) || find(selector),
      createElement: tag => { const e = new Element(tag); all.push(e); return e; }, createTextNode: text => ({ textContent: text }),
      importNode: node => node, addEventListener: (name, handler) => { events[name] = handler; },
    };
    globalThis.location = { origin: site.url, href: `${site.url}/?lab=idor` };
    globalThis.history = { pushState: (_, __, url) => { globalThis.location.href = url; } };
    globalThis.window = { addEventListener: (name, handler) => { events[name] = handler; } };
    globalThis.DOMParser = class { parseFromString(source) { return parseView(source); } };
    globalThis.FormData = class { get(name) { return ["1", "0", "1"][Number(name.slice(1))]; } };
    const sent = [];
    globalThis.fetch = (input, options) => {
      const url = typeof input === "string" ? new URL(input, site.url) : new URL(input.url);
      sent.push(url.pathname);
      return original.fetch(typeof input === "string" ? url : input, { ...options, headers: { Cookie: cookie } });
    };
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail("integrated lesson did not reach expected state");
    };
    // Initialize the shared controller explicitly; app's dynamic import uses this same module.
    const { initIdorLesson } = await import("../public/lab.js");
    dispose = initIdorLesson(root, true);
    root.dataset.initialized = "true";
    const app = await import("../public/app.js?integrated-test");
    await waitFor(() => viewNodes.get("#posts")?.attributes["aria-busy"] === "false");
    assert.equal(find("#observed-request").textContent, "");
    await find("#lesson-start").fire("click");
    const ownLink = viewNodes.get("#posts").children[0];
    ownLink.hasAttribute = () => false;
    let intercepted = false;
    events.click({ target: { closest: () => ownLink }, button: 0, preventDefault() { intercepted = true; } });
    await waitFor(() => find("#edit-start").disabled === false);
    assert.equal(intercepted, true);
    assert.match(find("#observed-request").textContent, /GET .*\/api\/posts\/101/);
    assert.match(find("#observed-request").textContent, /HTTP 200/);
    assert.equal(sent.filter(path => path === "/api/posts/101").length, 1);
    await find("#edit-start").fire("click");
    const stage = () => stages.findIndex(e => e.attributes["aria-current"] === "step") + 1;
    await waitFor(() => stage() === 3 && find("#request-fields").disabled === false);
    assert.equal(sent.filter(path => path === "/api/posts/101").length, 1, "captured normal request is reused without a fake/redundant fetch");
    disclosure.open = false;
    await app.navigateCommunity("/posts?lab=idor");
    await app.navigateCommunity("/posts/201?lab=idor");
    assert.equal(document.querySelector(".guide-panel"), disclosure);
    assert.equal(disclosure.open, false);
    Object.assign(location, { href: `${site.url}/posts?lab=idor` });
    events.popstate();
    await waitFor(() => document.body.dataset.page === "posts" && viewNodes.get("#posts")?.attributes["aria-busy"] === "false");
    assert.equal(document.querySelector(".guide-panel"), disclosure);
    assert.equal(disclosure.open, false);
    disclosure.open = true;
    assert.equal(stage(), 3);
    assert.equal(document.querySelector("#integrated-idor"), root);
    find("#request-id").value = "102";
    await find("#request-form").fire("submit");
    await waitFor(() => stage() === 4 && find("#request-fields").disabled === false);
    assert.equal(find("#learning-complete").hidden, true);
    await app.navigateCommunity("/posts?lab=idor");
    assert.equal(stage(), 4);
    await find("#study-code").fire("click");
    await waitFor(() => find("#lesson-code").children.length === 6);
    await find("#compare-request").fire("click");
    await waitFor(() => find("#quiz-start").disabled === false);
    assert.match(find("#comparison-result").textContent, /HTTP 403/);
    await find("#quiz-start").fire("click");
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, false);
    await app.navigateCommunity("/posts/201?lab=idor");
    assert.equal(find("#learning-complete").hidden, false);
    const { publishCommunitySession } = await import("../public/http-client.js");
    publishCommunitySession();
    assert.equal(stage(), 1);
    assert.equal(find("#learning-complete").hidden, true);
  } finally {
    dispose?.(); Object.assign(globalThis, original); await site.close();
  }
});

test("actual lesson handlers traverse all stages, gate completion, retry and reset evidence", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: true });
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, FormData: globalThis.FormData };
  const nodes = new Map();
  const stages = Array.from({ length: 6 }, (_, i) => { const e = new Element("button"); e.dataset.stage = String(i + 1); return e; });
  const panels = [];
  const all = [];
  const html = page("lab", { id: "user-a", name: "A", role: "user" }, undefined, true);
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element(); node.hidden = match[0].includes(" hidden"); nodes.set(`#${match[1]}`, node);
  }
  for (const match of html.matchAll(/data-stages="([^"]+)"/g)) {
    const e = new Element(); e.dataset.stages = match[1]; panels.push(e);
  }
  const find = selector => nodes.get(selector) || all.find(e => `#${e.id}` === selector);
  let answers = ["0", "1", "0"];
  let disabledLab = false;
  let invalidComparison = false;
  try {
    const login = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    globalThis.location = { origin: site.url };
    globalThis.document = {
      querySelector: find,
      querySelectorAll: selector => selector === "[data-stage]" ? stages : selector === "[data-stages]" ? panels : selector === "#lab-posts button" ? find("#lab-posts").children : all.filter(e => e.className === "quiz-explanation"),
      createElement: tag => { const e = new Element(tag); all.push(e); return e; },
      createTextNode: text => ({ textContent: text }),
    };
    globalThis.FormData = class { get(name) { return answers[Number(name.slice(1))]; } };
    globalThis.fetch = (input, options) => {
      const path = new URL(typeof input === "string" ? input : input.url, site.url).pathname;
      if (disabledLab && path.startsWith("/api/lab/vulnerable/")) return Promise.resolve(Response.json({ error: "NOT_FOUND" }, { status: 404 }));
      if (invalidComparison && path === "/api/posts/102") return Promise.resolve(Response.json({ error: "OTHER" }, { status: 403 }));
      return original.fetch(typeof input === "string" ? new URL(input, site.url) : input, { ...options, headers: { Cookie: cookie } });
    };
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail("lesson handler did not reach expected state");
    };
    const current = () => stages.findIndex(e => e.attributes["aria-current"] === "step") + 1;
    const { initIdorLesson } = await import("../public/lab.js");
    initIdorLesson(document);
    await waitFor(() => find("#lab-posts").children.length > 0);
    assert.equal(current(), 1);
    assert.equal(stages[5].disabled, true);
    assert.equal(find("#analysis-facts").children.length, 0);
    assert.ok(all.filter(e => e.className === "quiz-explanation").every(e => !e.textContent));
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, true);
    await find("#lesson-start").fire("click");
    assert.equal(current(), 2);
    await find("#lab-posts").children[0].fire("click");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.match(find("#normal-result").textContent, /\/api\/posts\/101/);
    await find("#edit-start").fire("click");
    assert.equal(current(), 3);
    find("#request-id").value = "201";
    await find("#request-form").fire("submit");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.equal(current(), 3, "public HTTP 200 is not discovery");
    find("#request-id").value = "102";
    await find("#request-form").fire("submit");
    await waitFor(() => current() === 4);
    assert.equal(find("#analysis-facts").children.length, 10);
    assert.match(find("#analysis-response").textContent, /HTTP 200/);
    assert.equal(find("#learning-complete").hidden, true);
    await find("#study-code").fire("click");
    assert.equal(current(), 5);
    await waitFor(() => find("#retry-code").disabled === false);
    assert.equal(find("#lesson-code").children.length, 6);
    invalidComparison = true;
    await find("#compare-request").fire("click");
    await waitFor(() => find("#compare-request").disabled === false);
    assert.equal(find("#quiz-start").disabled, true);
    assert.equal(stages[5].disabled, true);
    invalidComparison = false;
    await find("#compare-request").fire("click");
    await waitFor(() => find("#quiz-start").disabled === false);
    assert.match(find("#comparison-result").textContent, /HTTP 403/);
    await find("#quiz-start").fire("click");
    assert.equal(current(), 6);
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, true);
    assert.ok(find("#quiz-explanation-0").textContent.length > 0);
    answers = ["1", "0", "1"];
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, false);
    await find("#quiz-form").fire("change");
    assert.equal(find("#learning-complete").hidden, true);
    await stages[2].fire("click");
    find("#request-id").value = "201";
    await find("#request-form").fire("submit");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.equal(find("#analysis-facts").children.length, 0);
    assert.equal(stages[5].disabled, true);
    assert.equal(find("#learning-complete").hidden, true);
    disabledLab = true;
    find("#request-id").value = "102";
    await find("#request-form").fire("submit");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.equal(current(), 3);
    assert.match(find("#lab-feedback").textContent, /BASIC_SITE_ENABLE_IDOR=1/);
    assert.equal(find("#analysis-facts").children.length, 0);
    assert.equal(stages[5].disabled, true);
  } finally {
    Object.assign(globalThis, original);
    await site.close();
  }
});
